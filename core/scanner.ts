// Scan orchestration: discovery -> measurement -> classification -> aggregation.
//
// Explicit rule paths are probed first (cheap, most specific). Pattern rules
// then drive one bounded walk over the scan roots. Nothing here ever deletes,
// and all disk access goes through the Host.
import * as path from './paths';
import * as filesystem from './filesystem';
import * as analyzer from './analyzer';
import {PHOTO_PREFIX} from './policy';
import type {FileItem, Host, PhotoAsset, Storage} from './host';
import type {FileMatch, Finding, PhotoMatch, Report, Rule} from './types';

export type Source = 'disk' | 'photos' | 'files';

export interface ScanOptions {
  roots: string[];
  categories: string[] | null;
  excludes: string[];
  maxDepth: number;
  maxDirs: number;
  maxFindings: number;
  maxEntries: number;
  home: string | null;
  globalScan: boolean;
  usersDir: string;
  // What to look at: the disk (paths and patterns) and, when the host has them,
  // the photo library and the folders the user picked in the Files app.
  sources: Source[];
  // Reference time for age-based rules (defaults to now).
  now: number | null;
  log: (message: string) => void;
}

export const SCHEMA_VERSION = 1;
export const GLOBAL_EXCLUDES = ['/System', '/Volumes', '/dev', '/private', '/usr', '/bin', '/sbin'];
export const DEFAULTS: ScanOptions = {roots: [], categories: null, excludes: [], maxDepth: 6, maxDirs: 25_000, maxFindings: 500, maxEntries: 500_000, home: null, globalScan: false, usersDir: '/Users', sources: ['disk', 'photos', 'files'], now: null, log: () => {}};

function compare(a: string, b: string) {return a < b ? -1 : a > b ? 1 : 0;}

// Other users' homes, for a global scan.
function otherHomes(host: Host, usersDir: string, home: string, warnings: string[]) {
  try {
    return host.readdir(usersDir)
      .filter(entry => entry.kind === 'dir')
      .map(entry => path.join(usersDir, entry.name))
      .filter(dir => dir !== home)
      .sort();
  } catch (error) {
    warnings.push(`cannot list ${usersDir}: ${(error as Error).message}`);
    return [];
  }
}

function explicitTargets(host: Host, rule: Rule, home: string, log: ScanOptions['log']) {
  const targets: string[] = [];
  for (const entry of rule.paths) {
    const expanded = filesystem.expandPath(entry, home, name => host.env(name));
    if (filesystem.hasGlobMagic(entry)) targets.push(...filesystem.glob(host, expanded));
    else if (filesystem.lexists(host, expanded)) targets.push(expanded);
    else log(`rule ${rule.id}: path not found: ${expanded}`);
  }
  return targets;
}

function ruleFor(host: Host, target: string, patternRules: Rule[]) {
  return patternRules.find(rule =>
    rule.patterns.some(pattern => filesystem.rulePatternMatches(target, pattern)) &&
    (!rule.markers.length || rule.markers.some(marker => filesystem.isFile(host, path.join(path.dirname(target), marker)))));
}

// Ids of items that are exact copies of an older one: same kind, pixel size,
// duration and bytes. The oldest copy of each group stays out.
// When the host hashed the content (`digest`), only identical bytes count, and an
// item it couldn't read (null) is never a copy.
export function duplicateExtras(assets: PhotoAsset[]): Map<string, PhotoAsset> {
  const keyed = assets.filter(asset => asset.bytes !== null && asset.width && asset.height && asset.digest !== null)
    .map(asset => [`${asset.media} ${asset.width}x${asset.height} ${asset.duration_ms ?? 0} ${asset.bytes} ${asset.digest ?? ''}`, asset] as const);
  return oldestKept(keyed, asset => asset.created_ms, asset => asset.id);
}

// Files with the same content (size and SHA-256) as an older file, by path, each
// with the file that stays. Files the host didn't hash never count: names alone
// say nothing about content.
export function duplicateFileExtras(items: FileItem[]): Map<string, FileItem> {
  return oldestKept(items.filter(item => item.digest).map(item => [`${item.bytes} ${item.digest}`, item] as const), item => item.modified_ms, item => item.path);
}

// In each group of equal keys, every item but the oldest, with the oldest (which stays).
function oldestKept<T>(keyed: (readonly [string, T])[], time: (item: T) => number, id: (item: T) => string): Map<string, T> {
  const groups = new Map<string, T[]>();
  for (const [key, item] of keyed) groups.set(key, [...groups.get(key) ?? [], item]);
  const extras = new Map<string, T>();
  for (const group of groups.values()) {
    const [keeper, ...rest] = group.sort((a, b) => time(a) - time(b) || compare(id(a), id(b)));
    for (const item of rest) extras.set(id(item), keeper!);
  }
  return extras;
}

// For each photo that is not the keeper of its `similar` group, the photo that stays.
// Favorites stay; without one, the best score stays (then the larger, then the older).
export function similarExtras(assets: PhotoAsset[]): Map<string, PhotoAsset> {
  const groups = new Map<string, PhotoAsset[]>();
  for (const asset of assets) if (asset.similar) groups.set(asset.similar, [...groups.get(asset.similar) ?? [], asset]);
  const extras = new Map<string, PhotoAsset>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false) || (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
      (b.bytes ?? 0) - (a.bytes ?? 0) || a.created_ms - b.created_ms || compare(a.id, b.id));
    for (const asset of ranked.slice(1)) if (!asset.favorite) extras.set(asset.id, ranked[0]!);
  }
  return extras;
}

// The photo that stays for a copy or a similar photo: its name ('Fica', shown in
// the details) and its path (`keeper`, so the app can show the group together).
function keeperOf(keeper: PhotoAsset | undefined): Record<string, string> {
  return keeper ? {'Fica': keeper.name, keeper: PHOTO_PREFIX + keeper.id} : {};
}

// Items only in iCloud are listed too (deleting them frees iCloud, which people
// pay for), marked `on_device: no` so the app can badge, count and filter them.
export const ONLY_IN_ICLOUD = 'Só no iCloud. O iPhone guarda só uma versão leve, então apagar libera espaço no iCloud, quase nada no iPhone.';
const ONLY_IN_ICLOUD_DRIVE = 'Só no iCloud Drive, sem cópia no iPhone. Apagar libera espaço no iCloud, não no iPhone.';
const inCloudOnly = (text: string) => ({'Onde está': text, on_device: 'no'});

// Where the original is, for the details dialog.
function storedAt({local, cloud}: PhotoAsset): string | null {
  if (local === false) return ONLY_IN_ICLOUD;
  if (local && cloud) return 'No iPhone e no iCloud. Para tirar do iPhone sem apagar, ligue Ajustes › Fotos › Otimizar Armazenamento do iPhone.';
  if (local && cloud === false) return 'Só no iPhone, sem cópia no iCloud. Apagar remove a única cópia.';
  return null;
}

// Whether a photo library item meets every criterion of `match`. `extras` and
// `similar` come from duplicateExtras() and similarExtras().
export function photoMatches(match: PhotoMatch, asset: PhotoAsset, now: number, extras: Map<string, PhotoAsset> = new Map(), similar: Map<string, PhotoAsset> = new Map()): boolean {
  return (!match.media || asset.media === match.media) &&
    (!match.subtype || asset.subtypes.includes(match.subtype)) &&
    (!match.burst || asset.burst === match.burst) &&
    (!match.duplicate || extras.has(asset.id)) &&
    (!match.similar || similar.has(asset.id)) &&
    (match.min_bytes === undefined || (asset.bytes !== null && asset.bytes >= match.min_bytes)) &&
    (match.min_age_days === undefined || now - asset.created_ms >= match.min_age_days * 86400000);
}

// Whether a file from a picked folder meets every criterion of `match`. `extras` comes from duplicateFileExtras().
export function fileMatches(match: FileMatch, item: FileItem, now: number, extras: Map<string, FileItem> = new Map()): boolean {
  const folders = path.dirname(item.path).split('/'), name = path.basename(item.path), dot = name.lastIndexOf('.');
  return (!match.folders || match.folders.some(folder => folders.includes(folder))) &&
    (!match.extensions || (dot > 0 && match.extensions.includes(name.slice(dot + 1).toLowerCase()))) &&
    (!match.duplicate || extras.has(item.path)) &&
    (match.min_bytes === undefined || item.bytes >= match.min_bytes) &&
    (match.min_age_days === undefined || now - item.modified_ms >= match.min_age_days * 86400000);
}

function fileStoredAt({local, cloud}: FileItem): string | null {
  if (local === false) return ONLY_IN_ICLOUD_DRIVE;
  if (local && cloud) return 'No iPhone e no iCloud Drive. Para tirar do iPhone sem apagar, toque e segure o arquivo no app Arquivos e escolha Remover Download.';
  if (local && cloud === false) return 'Só no iPhone, sem cópia no iCloud. Apagar remove a única cópia.';
  return null;
}

function readStorage(host: Host, target: string): Storage | null {
  try {return host.storage?.(target) ?? null;} catch {return null;}
}

// Run a scan on `host` with `options` (see DEFAULTS) over `rules` and return the report (schema_version 1).
export function scan(host: Host, rules: Rule[], options: Partial<ScanOptions> = {}): Report {
  const opts: ScanOptions = {...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))};
  const warnings: string[] = [];
  const categories = opts.categories?.length ? new Set(opts.categories) : null;
  // The generic per-app cache rule runs last so specific cache rules claim their folders first.
  const selected = rules.filter(rule => !categories || categories.has(rule.category))
    .sort((a, b) => Number(a.id === 'user-app-caches') - Number(b.id === 'user-app-caches'));
  if (!selected.length) warnings.push('no rules match the requested categories; nothing to scan');

  const cwd = host.cwd();
  const disk = opts.sources.includes('disk');
  const home = path.resolve(cwd, opts.home ?? host.home());
  const homes = [home, ...(disk && opts.globalScan ? otherHomes(host, opts.usersDir, home, warnings) : [])];
  const roots = [...new Set([...homes, ...opts.roots.map(root => path.resolve(cwd, root)), ...(opts.globalScan ? ['/'] : [])])];
  // Without the disk source there is nothing to walk, so no root to check.
  const scanRoots = !disk ? [] : roots.filter(root => {
    if (filesystem.isDir(host, root)) return true;
    warnings.push(`scan root does not exist or is not a directory: ${root}`);
    return false;
  });
  const scanExcludes = [...opts.excludes, ...(opts.globalScan ? GLOBAL_EXCLUDES : [])];

  const findings: Finding[] = [];
  const seen = new Map<string, string>(); // resolved target path -> rule_id (keeps first match)
  const full = () => findings.length >= opts.maxFindings;
  function add(target: string, rule: Rule) {
    if (filesystem.excluded(target, opts.excludes)) return opts.log(`excluding ${target}`);
    const key = host.realpath(target) ?? path.resolve(cwd, target);
    if (seen.has(key)) return opts.log(`duplicate target ${target} (kept rule ${seen.get(key)})`);
    const measured = filesystem.measure(host, target, {maxEntries: opts.maxEntries});
    if (measured.errors) warnings.push(`errors while measuring ${target} (${measured.errors} error(s))`);
    seen.set(key, rule.id);
    findings.push({
      rule_id: rule.id, name: rule.name, category: rule.category, severity: analyzer.classify(rule),
      reclaimable: rule.reclaimable, description: rule.description, path: target,
      size_bytes: measured.bytes, size_complete: !measured.truncated && !measured.errors,
      last_modified: filesystem.mtime(host, target), rebuild: rule.rebuild, metadata: {},
    });
  }

  const stopped = () => warnings.push(`reached max findings (${opts.maxFindings}); scan stopped early`);

  // 1. Explicit rule paths (most specific, no walking required).
  explicit: for (const rule of disk ? selected : []) {
    if (full()) break;
    for (const userHome of homes) {
      for (const target of explicitTargets(host, rule, userHome, opts.log)) {
        add(target, rule);
        if (full()) {stopped(); break explicit;}
      }
    }
  }

  // 2. Pattern discovery over the scan roots (bounded walk).
  const patternRules = disk ? selected.filter(rule => rule.patterns.length) : [];
  if (patternRules.length && !full()) {
    const patterns = [...new Set(patternRules.flatMap(rule => rule.patterns))].sort();
    for (const target of filesystem.iterMatches(host, scanRoots, patterns, {maxDepth: opts.maxDepth, maxDirs: opts.maxDirs, excludes: scanExcludes, warnings})) {
      if (full()) {stopped(); break;}
      const rule = ruleFor(host, target, patternRules);
      if (rule) add(target, rule);
    }
  }

  // 3. Photo library items, on hosts that list them. The first matching rule wins.
  const photoRules = opts.sources.includes('photos') && host.photos ? selected.filter(rule => rule.photos) : [];
  if (photoRules.length && !full()) {
    let assets: PhotoAsset[] = [];
    try {assets = host.photos!();} catch (error) {warnings.push(`cannot read photos: ${(error as Error).message}`);}
    const now = opts.now ?? Date.now(), extras = duplicateExtras(assets), similar = similarExtras(assets);
    for (const asset of assets) {
      const rule = photoRules.find(rule => photoMatches(rule.photos!, asset, now, extras, similar));
      if (!rule) continue;
      if (full()) {stopped(); break;}
      const stored = storedAt(asset);
      findings.push({
        rule_id: rule.id, name: rule.name, category: rule.category, severity: analyzer.classify(rule),
        reclaimable: rule.reclaimable, description: rule.description, path: PHOTO_PREFIX + asset.id,
        size_bytes: asset.bytes ?? 0, size_complete: asset.bytes !== null,
        last_modified: new Date(asset.created_ms).toISOString(), rebuild: rule.rebuild,
        metadata: {label: asset.name, ...stored ? {'Onde está': stored} : {}, ...asset.local === false ? {on_device: 'no'} : {}, ...keeperOf(rule.photos!.similar ? similar.get(asset.id) : rule.photos!.duplicate ? extras.get(asset.id) : undefined)},
      });
    }
  }

  // 4. Files in the folders the user picked, on hosts that list them.
  const fileRules = opts.sources.includes('files') && host.files ? selected.filter(rule => rule.files) : [];
  if (fileRules.length && !full()) {
    let items: FileItem[] = [];
    try {items = host.files!();} catch (error) {warnings.push(`cannot read picked folders: ${(error as Error).message}`);}
    const now = opts.now ?? Date.now(), extras = duplicateFileExtras(items);
    for (const item of items) {
      const rule = fileRules.find(rule => fileMatches(rule.files!, item, now, extras));
      if (!rule) continue;
      if (full()) {stopped(); break;}
      const stored = fileStoredAt(item);
      findings.push({
        rule_id: rule.id, name: rule.name, category: rule.category, severity: analyzer.classify(rule),
        reclaimable: rule.reclaimable, description: rule.description, path: item.path,
        size_bytes: item.bytes, size_complete: true, last_modified: new Date(item.modified_ms).toISOString(), rebuild: rule.rebuild,
        metadata: {label: item.label, ...stored ? {'Onde está': stored} : {}, ...item.local === false ? {on_device: 'no'} : {}, ...rule.files!.duplicate && extras.get(item.path) ? {'Fica': extras.get(item.path)!.label} : {}},
      });
    }
  }

  for (const finding of findings) analyzer.enrich(host, finding);
  findings.sort((a, b) => compare(a.category, b.category) || compare(a.name, b.name) || compare(a.path, b.path));
  return {
    schema_version: SCHEMA_VERSION,
    scanned_at: new Date().toISOString(),
    roots: scanRoots,
    options: {global_scan: opts.globalScan, max_depth: opts.maxDepth, max_findings: opts.maxFindings, excludes: scanExcludes, categories: [...(categories ?? [])].sort()},
    totals: analyzer.buildTotals(findings),
    findings,
    warnings,
    storage: readStorage(host, home),
  };
}

// Marks findings at `paths` as only in iCloud, for hosts that check it more
// precisely after the scan (the iPhone reads the start of each original).
export function markOnlyInCloud<R extends {findings: Finding[]}>(report: R, paths: string[]): R {
  const cloud = new Set(paths);
  return {...report, findings: report.findings.map(f => cloud.has(f.path) && f.path.startsWith(PHOTO_PREFIX) ? {...f, metadata: {...f.metadata, ...inCloudOnly(ONLY_IN_ICLOUD)}} : f)};
}
