import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {buildTotals} from '../core/analyzer';
import type {Finding, Report} from '../core';

// The cleanup policy the main process decided for a finding.
interface CleanupFields {
  cleanup_allowed: boolean;
  cleanup_review: boolean;
  cleanup_reason: string;
  auto_clean: boolean;
}
export interface CleanupFinding extends Finding, CleanupFields {}
export interface CleanupReport extends Omit<Report, 'findings'> {findings: CleanupFinding[]; cleanup_token: string}
// Path -> identity captured by prepare(); a target must still match it when trashed.
export type Manifest = Map<string, string>;
export interface CleanupOutcome {moved: {path: string; size_bytes: number}[]; errors: {path: string; message: string}[]}
type PolicyInput = Pick<Finding, 'rule_id' | 'path' | 'severity' | 'reclaimable' | 'size_complete'> & Partial<Pick<Finding, 'metadata' | 'last_modified'>>;
interface Policy {allowed: boolean; review: boolean; reason?: string}

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
// Project outputs only qualify when the project has not been touched for STALE_DAYS.
function isAutomatic(finding: PolicyInput, now: number) {
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
function inside(target: string, root: string) {return target === root || root.startsWith(target + path.sep) || target.startsWith(root + path.sep);}
// Cleanup policy for one finding: {allowed, review, reason}.
function policy(finding: PolicyInput, home: string, appRoot: string): Policy {
  const target = path.resolve(finding.path);
  const deny = (reason: string): Policy => ({allowed:false, review:false, reason});
  if (inside(target, appRoot)) return deny('Arquivos do próprio DevClean estão protegidos.');
  if (!finding.size_complete) return deny('O macOS não permitiu ler tudo nesta pasta. Conceda Acesso Total ao Disco ou limpe pelo Finder.');
  const blocked = blockedReasons[finding.rule_id];
  if (blocked) return deny(blocked);
  const project = projectOutputs[finding.rule_id];
  if (project) {
    if (!target.startsWith(home + path.sep)) return deny('Pacotes instalados globalmente ficam fora da limpeza. Desinstale pelo gerenciador de pacotes.');
    const ok = path.basename(target) === project.dir && finding.metadata?.[project.marker] === 'yes' && target !== path.join(home, project.dir);
    return ok ? {allowed:true, review:false} : deny(`Só é limpo quando há ${project.marker} no projeto.`);
  }
  if (finding.severity === 'SAFE' && finding.reclaimable && (targets[finding.rule_id] || []).some(rel => matches(target, home, rel))) return {allowed:true, review:false};
  if (finding.severity !== 'DANGER' && (reviewTargets[finding.rule_id] || []).some(rel => matches(target, home, rel))) return {allowed:true, review:true};
  return deny('Este local não está na lista de limpeza do DevClean.');
}
async function hasMarker(finding: PolicyInput) {
  const project = projectOutputs[finding.rule_id];
  if (!project) return true;
  const info = await fs.lstat(path.join(path.dirname(finding.path), project.marker)).catch(() => null);
  return Boolean(info?.isFile());
}
// Files that belong to a target and go to the Trash with it (an AVD's .ini).
async function companions(finding: PolicyInput) {
  if (finding.rule_id !== 'android-avds') return [];
  const ini = finding.path.replace(/\.avd$/, '.ini');
  const info = await fs.lstat(ini).catch(() => null);
  return info?.isFile() ? [ini] : [];
}
async function identity(target: string) {
  const resolved = path.resolve(target);
  if (resolved !== target) throw new Error('Caminho não canônico.');
  let current = resolved;
  while (true) {
    const info = await fs.lstat(current);
    if (info.isSymbolicLink()) throw new Error('Links simbólicos não podem ser limpos.');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() && !stat.isFile()) throw new Error('O alvo não é um arquivo nem um diretório.');
  return `${await fs.realpath(resolved)}:${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}`;
}
// Annotate every finding of `report` (a scanner report, or any object with findings) with its cleanup policy.
export async function prepare<R extends {findings: PolicyInput[]}>(report: R, home: string, appRoot: string, now = Date.now()):
  Promise<{report: Omit<R, 'findings'> & {findings: (R['findings'][number] & CleanupFields)[]; cleanup_token: string}; manifest: Manifest}> {
  const manifest: Manifest = new Map();
  const findings = await Promise.all(report.findings.map(async f => {
    let {allowed, review, reason} = policy(f, home, appRoot);
    if (allowed && !await hasMarker(f)) [allowed, reason] = [false, 'O arquivo do projeto não existe mais. Analise novamente.'];
    if (allowed) {
      try {manifest.set(f.path, await identity(f.path)); return {...f, cleanup_allowed:true, cleanup_review:review, cleanup_reason:'', auto_clean:!review && isAutomatic(f, now)};}
      catch {reason = 'Caminho indisponível ou contém link simbólico. Analise novamente.';}
    }
    return {...f, cleanup_allowed:false, cleanup_review:false, cleanup_reason:reason!, auto_clean:false};
  }));
  return {report:{...report, findings, cleanup_token:crypto.randomUUID()}, manifest};
}
type Prepared = {path: string; size_bytes: number; cleanup_allowed: boolean};
export function select<F extends Prepared>(report: {findings: F[]; cleanup_token: string} | null, indices: unknown, token: unknown): F[] {
  if (!report || token !== report.cleanup_token) throw new Error('Relatório desatualizado. Analise novamente.');
  if (!Array.isArray(indices) || !indices.length || indices.length > 1000) throw new Error('Seleção inválida.');
  const selected = [...new Set(indices)].map(index => {
    if (!Number.isInteger(index) || index < 0 || !report.findings[index]?.cleanup_allowed) throw new Error('Item não autorizado para limpeza.');
    return report.findings[index]!;
  });
  for (let i=0;i<selected.length;i++) for(let j=i+1;j<selected.length;j++) {
    const a=selected[i]!.path, b=selected[j]!.path;
    if (a===b || a.startsWith(b+path.sep) || b.startsWith(a+path.sep)) throw new Error('A seleção contém diretórios sobrepostos.');
  }
  return selected;
}
export async function validate(selected: {path: string}[], manifest: Manifest) {
  for (const f of selected) {
    if (!manifest.has(f.path) || await identity(f.path) !== manifest.get(f.path)) throw new Error(`O diretório mudou desde a análise: ${f.path}. Analise novamente.`);
  }
}
export async function moveToTrash(selected: (PolicyInput & {size_bytes: number})[], manifest: Manifest, trashItem: (target: string) => Promise<unknown>): Promise<CleanupOutcome> {
  await validate(selected, manifest);
  const moved: CleanupOutcome['moved'] = [], errors: CleanupOutcome['errors'] = [];
  for (const f of selected) {
    try {
      await validate([f], manifest);
      const extra = await companions(f);
      await trashItem(f.path);
      manifest.delete(f.path);
      for (const file of extra) await trashItem(file).catch(() => {});
      moved.push({path:f.path, size_bytes:f.size_bytes});
    } catch (error) {errors.push({path:f.path, message:(error as Error).message});}
  }
  return {moved, errors};
}
export function remainingReport<R extends {findings: Pick<Finding, 'path' | 'severity' | 'category' | 'size_bytes'>[]}>(report: R, moved: {path: string}[]) {
  const removed = new Set(moved.map(f=>f.path));
  const findings = report.findings.filter(f=>!removed.has(f.path)) as R['findings'];
  return {...report, findings, totals:buildTotals(findings), cleanup_token:crypto.randomUUID()};
}
