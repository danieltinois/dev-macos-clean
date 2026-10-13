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
export function duplicateExtras(assets: PhotoAsset[]): Set<string> {
  const groups = new Map<string, PhotoAsset[]>();
  for (const asset of assets) {
    if (asset.bytes === null || !asset.width || !asset.height) continue;
    const key = `${asset.media} ${asset.width}x${asset.height} ${asset.duration_ms ?? 0} ${asset.bytes}`;
    groups.set(key, [...groups.get(key) ?? [], asset]);
  }
  const extras = new Set<string>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.created_ms - b.created_ms || compare(a.id, b.id)).slice(1).forEach(asset => extras.add(asset.id));
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

// Where the original is, for the details dialog (items only in iCloud never get here).
function storedAt({local, cloud}: PhotoAsset): string | null {
  if (local && cloud) return 'No iPhone e no iCloud. Para tirar do iPhone sem apagar, ligue Ajustes › Fotos › Otimizar Armazenamento do iPhone.';
  if (local && cloud === false) return 'Só no iPhone, sem cópia no iCloud. Apagar remove a única cópia.';
  return null;
}

// Whether a photo library item meets every criterion of `match`. `extras` and
// `similar` come from duplicateExtras() and similarExtras().
export function photoMatches(match: PhotoMatch, asset: PhotoAsset, now: number, extras: Set<string> = new Set(), similar: Map<string, PhotoAsset> = new Map()): boolean {
  return (!match.media || asset.media === match.media) &&
    (!match.subtype || asset.subtypes.includes(match.subtype)) &&
    (!match.burst || asset.burst === match.burst) &&
    (!match.duplicate || extras.has(asset.id)) &&
    (!match.similar || similar.has(asset.id)) &&
    (match.min_bytes === undefined || (asset.bytes !== null && asset.bytes >= match.min_bytes)) &&
    (match.min_age_days === undefined || now - asset.created_ms >= match.min_age_days * 86400000);
}

// Whether a file from a picked folder meets every criterion of `match`.
export function fileMatches(match: FileMatch, item: FileItem, now: number): boolean {
  return (!match.folder || path.dirname(item.path).split('/').includes(match.folder)) &&
    (match.min_bytes === undefined || item.bytes >= match.min_bytes) &&
    (match.min_age_days === undefined || now - item.modified_ms >= match.min_age_days * 86400000);
}

function fileStoredAt({local, cloud}: FileItem): string | null {
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
  // Items only in iCloud take no space on the device, so they never become findings;
  // they still count as the original when looking for copies.
  const photoRules = opts.sources.includes('photos') && host.photos ? selected.filter(rule => rule.photos) : [];
  if (photoRules.length && !full()) {
    let assets: PhotoAsset[] = [];
    try {assets = host.photos!();} catch (error) {warnings.push(`cannot read photos: ${(error as Error).message}`);}
    const now = opts.now ?? Date.now(), extras = duplicateExtras(assets), similar = similarExtras(assets);
    for (const asset of assets) {
      if (asset.local === false) continue;
      const rule = photoRules.find(rule => photoMatches(rule.photos!, asset, now, extras, similar));
      if (!rule) continue;
      if (full()) {stopped(); break;}
      const stored = storedAt(asset);
      findings.push({
        rule_id: rule.id, name: rule.name, category: rule.category, severity: analyzer.classify(rule),
        reclaimable: rule.reclaimable, description: rule.description, path: PHOTO_PREFIX + asset.id,
        size_bytes: asset.bytes ?? 0, size_complete: asset.bytes !== null,
        last_modified: new Date(asset.created_ms).toISOString(), rebuild: rule.rebuild,
        metadata: {label: asset.name, ...stored ? {'Onde está': stored} : {}, ...rule.photos!.similar ? {'Fica': similar.get(asset.id)!.name} : {}},
      });
    }
  }

  // 4. Files in the folders the user picked, on hosts that list them. Like photos,
  // files only in iCloud Drive take no space on the device and are skipped.
  const fileRules = opts.sources.includes('files') && host.files ? selected.filter(rule => rule.files) : [];
  if (fileRules.length && !full()) {
    let items: FileItem[] = [];
    try {items = host.files!();} catch (error) {warnings.push(`cannot read picked folders: ${(error as Error).message}`);}
    const now = opts.now ?? Date.now();
    for (const item of items) {
      if (item.local === false) continue;
      const rule = fileRules.find(rule => fileMatches(rule.files!, item, now));
      if (!rule) continue;
      if (full()) {stopped(); break;}
      const stored = fileStoredAt(item);
      findings.push({
        rule_id: rule.id, name: rule.name, category: rule.category, severity: analyzer.classify(rule),
        reclaimable: rule.reclaimable, description: rule.description, path: item.path,
        size_bytes: item.bytes, size_complete: true, last_modified: new Date(item.modified_ms).toISOString(), rebuild: rule.rebuild,
        metadata: {label: item.label, ...stored ? {'Onde está': stored} : {}},
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
