// Cleanup policy: which findings may be moved, which need review and which
// cleanup is automatic. The scanner decides what exists; this decides what may
// be moved. A rule never grants cleanup.
//
// Only decisions live here. The trusted side (apple/DevCleanKit Cleanup.swift)
// captures identities, issues tokens and moves to the Trash.
import * as path from './paths';
import {buildTotals} from './analyzer';
import type {Host} from './host';
import type {Finding} from './types';

export type PolicyInput = Pick<Finding, 'rule_id' | 'path' | 'severity' | 'reclaimable' | 'size_complete'> & Partial<Pick<Finding, 'metadata' | 'last_modified'>>;
export interface Policy {allowed: boolean; review: boolean; reason?: string}

// Fixed, home-relative locations of known regenerable caches. A trailing `*`
// matches versioned folder names directly inside the same parent.
const targets: Record<string, string[]> = {
  'homebrew-cache': ['Library/Caches/Homebrew'],
  'pip-cache': ['Library/Caches/pip', '.cache/pip'],
  'cargo-cache': ['.cargo/registry/cache'],
  'npm-cache': ['.npm/_cacache'],
  'gradle-cache': ['.gradle/caches'],
  'gradle-wrapper': ['.gradle/wrapper/dists'],
  'pnpm-cache': ['Library/Caches/pnpm'],
  'yarn-cache': ['Library/Caches/Yarn'],
  'bun-cache': ['.bun/install/cache'],
  'playwright-browsers': ['Library/Caches/ms-playwright'],
  'xcode-derived-data': ['Library/Developer/Xcode/DerivedData'],
  'xcode-device-support': ['Library/Developer/Xcode/iOS DeviceSupport', 'Library/Developer/Xcode/watchOS DeviceSupport', 'Library/Developer/Xcode/tvOS DeviceSupport'],
  'ios-simulator-caches': ['Library/Developer/CoreSimulator/Caches'],
  'cocoapods-cache': ['Library/Caches/CocoaPods'],
  'go-build-cache': ['Library/Caches/go-build'],
  'go-mod-cache': ['go/pkg/mod'],
  'pub-cache': ['.pub-cache/hosted'],
  'jetbrains-caches': ['Library/Caches/JetBrains', 'Library/Caches/Google/AndroidStudio*'],
};
// Per-project build outputs: directory name and the project file that must sit next to it.
const projectOutputs: Record<string, {dir: string; marker: string}> = {
  'node-modules': {dir: 'node_modules', marker: 'package.json'},
  'rust-target': {dir: 'target', marker: 'Cargo.toml'},
};
// Automatic cleanup: caches the tool recreates by itself, with no manual step,
// no lost local work and no open app holding them. Everything else needs a click.
const automatic = new Set([
  'xcode-derived-data', 'ios-simulator-caches', 'cocoapods-cache', 'homebrew-cache', 'pip-cache',
  'npm-cache', 'pnpm-cache', 'yarn-cache', 'bun-cache', 'go-build-cache', 'gradle-cache', 'gradle-wrapper', 'pub-cache',
]);
export const STALE_DAYS = 90;
// Photo library items are reported as `photos://<id>`. Only these rules may
// remove them, always for review, never automatically. They go to the
// library's Recently Deleted album, confirmed by the system.
export const PHOTO_PREFIX = 'photos://';
// Files from folders the user picked in the Files app (iPhone): only these rules,
// only regular files, always for review. They go to Recently Deleted in Files.
const fileTargets = new Set(['large-files', 'old-downloads']);
const photoTargets = new Set(['large-videos', 'large-photos', 'duplicate-photos', 'similar-photos', 'screenshots', 'screen-recordings', 'burst-extras']);
// Project outputs only qualify when the project has not been touched for STALE_DAYS.
export function isAutomatic(finding: PolicyInput, now: number) {
  if (automatic.has(finding.rule_id)) return true;
  if (!projectOutputs[finding.rule_id]) return false;
  const modified = Date.parse(finding.last_modified ?? '');
  return Number.isFinite(modified) && now - modified >= STALE_DAYS * 86400000;
}
// "Revisar" items the user may still send to the Trash by hand: never automatic,
// always flagged in the confirmation. Matched against fixed home-relative places.
const reviewTargets: Record<string, string[]> = {
  'android-system-images': ['Library/Android/sdk/system-images'],
  'android-avds': ['.android/avd/*.avd'],
  'xcode-archives': ['Library/Developer/Xcode/Archives'],
  'maven-repository': ['.m2/repository'],
  'user-app-caches': ['Library/Caches/*'],
  'user-logs': ['Library/Logs/*'],
};
// Review items that stay blocked, with the way to clean them instead.
const blockedReasons: Record<string, string> = {
  'downloads': 'Mover a pasta Downloads inteira quebraria o Finder. Use “Mostrar no Finder” e escolha os arquivos.',
  'docker-data': 'Apagar o disco do Docker corrompe containers e volumes. Use os comandos em Detalhes.',
  'ios-simulators': 'Remova simuladores pelo Xcode ou com o comando em Detalhes.',
};
function matches(target: string, home: string, rel: string) {
  const full = path.join(home, rel);
  if (!rel.includes('*')) return target === full;
  if (path.dirname(target) !== path.dirname(full)) return false;
  const [prefix = '', suffix = ''] = path.basename(full).split('*');
  const name = path.basename(target);
  return name.startsWith(prefix) && name.endsWith(suffix) && name.length > prefix.length + suffix.length;
}
// Either path contains the other.
export function overlaps(a: string, b: string) {return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);}

// Cleanup policy for one finding: {allowed, review, reason}. `appRoot` is the app's own files.
export function policy(host: Host, finding: PolicyInput, home: string, appRoot: string): Policy {
  const deny = (reason: string): Policy => ({allowed:false, review:false, reason});
  if (finding.path.startsWith(PHOTO_PREFIX)) {
    return photoTargets.has(finding.rule_id) && finding.severity !== 'DANGER' ? {allowed:true, review:true} : deny('Este item não está na lista de limpeza do DevClean.');
  }
  const target = path.resolve(host.cwd(), finding.path);
  if (overlaps(target, appRoot)) return deny('Arquivos do próprio DevClean estão protegidos.');
  if (fileTargets.has(finding.rule_id)) {
    return finding.severity !== 'DANGER' && host.lstat(target)?.kind === 'file' ? {allowed:true, review:true} : deny('Só arquivos comuns das pastas que você escolheu podem ser limpos.');
  }
  if (!finding.size_complete) return deny('O macOS não permitiu ler tudo nesta pasta. Conceda Acesso Total ao Disco ou limpe pelo Finder.');
  const blocked = blockedReasons[finding.rule_id];
  if (blocked) return deny(blocked);
  const project = projectOutputs[finding.rule_id];
  if (project) {
    if (!target.startsWith(home + path.sep)) return deny('Pacotes instalados globalmente ficam fora da limpeza. Desinstale pelo gerenciador de pacotes.');
    const ok = path.basename(target) === project.dir && finding.metadata?.[project.marker] === 'yes' && target !== path.join(home, project.dir);
    if (!ok) return deny(`Só é limpo quando há ${project.marker} no projeto.`);
    // The metadata alone is not enough: the project file must still exist.
    return hasMarker(host, finding) ? {allowed:true, review:false} : deny('O arquivo do projeto não existe mais. Analise novamente.');
  }
  if (finding.severity === 'SAFE' && finding.reclaimable && (targets[finding.rule_id] || []).some(rel => matches(target, home, rel))) return {allowed:true, review:false};
  if (finding.severity !== 'DANGER' && (reviewTargets[finding.rule_id] || []).some(rel => matches(target, home, rel))) return {allowed:true, review:true};
  return deny('Este local não está na lista de limpeza do DevClean.');
}
function hasMarker(host: Host, finding: PolicyInput) {
  const project = projectOutputs[finding.rule_id];
  return !project || host.lstat(path.join(path.dirname(finding.path), project.marker))?.kind === 'file';
}

// Files that belong to a target and go to the Trash with it (an AVD's .ini).
export function companions(host: Host, finding: Pick<PolicyInput, 'rule_id' | 'path'>): string[] {
  if (finding.rule_id !== 'android-avds') return [];
  const ini = finding.path.replace(/\.avd$/, '.ini');
  return host.lstat(ini)?.kind === 'file' ? [ini] : [];
}

type Selectable = {path: string; cleanup_allowed: boolean};
// The findings at `indices`, only when every one is cleanable and none overlaps another.
// The caller checks the report token first.
export function select<F extends Selectable>(findings: F[], indices: unknown): F[] {
  if (!Array.isArray(indices) || !indices.length || indices.length > 1000) throw new Error('Seleção inválida.');
  const selected = [...new Set(indices)].map(index => {
    if (!Number.isInteger(index) || index < 0 || !findings[index]?.cleanup_allowed) throw new Error('Item não autorizado para limpeza.');
    return findings[index]!;
  });
  for (let i=0;i<selected.length;i++) for(let j=i+1;j<selected.length;j++) {
    if (overlaps(selected[i]!.path, selected[j]!.path)) throw new Error('A seleção contém diretórios sobrepostos.');
  }
  return selected;
}

// `report` without the `moved` paths, with fresh totals.
export function withoutMoved<R extends {findings: Pick<Finding, 'path' | 'severity' | 'category' | 'size_bytes'>[]}>(report: R, moved: {path: string}[]) {
  const removed = new Set(moved.map(f=>f.path));
  const findings = report.findings.filter(f=>!removed.has(f.path)) as R['findings'];
  return {...report, findings, totals:buildTotals(findings)};
}
