const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {buildTotals} = require('../core/analyzer.cjs');
// Fixed, home-relative locations of known regenerable caches. A trailing `*`
// matches versioned folder names directly inside the same parent.
const targets = {
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
const projectOutputs = {
  'node-modules': {dir: 'node_modules', marker: 'package.json'},
  'rust-target': {dir: 'target', marker: 'Cargo.toml'},
};
// Automatic cleanup: caches the tool recreates by itself, with no manual step,
// no lost local work and no open app holding them. Everything else needs a click.
const automatic = new Set([
  'xcode-derived-data', 'ios-simulator-caches', 'cocoapods-cache', 'homebrew-cache', 'pip-cache',
  'npm-cache', 'pnpm-cache', 'yarn-cache', 'bun-cache', 'go-build-cache', 'gradle-cache', 'gradle-wrapper', 'pub-cache',
]);
const STALE_DAYS = 90;
// Project outputs only qualify when the project has not been touched for STALE_DAYS.
function isAutomatic(finding, now) {
  if (automatic.has(finding.rule_id)) return true;
  if (!projectOutputs[finding.rule_id]) return false;
  const modified = Date.parse(finding.last_modified);
  return Number.isFinite(modified) && now - modified >= STALE_DAYS * 86400000;
}
// "Revisar" items the user may still send to the Trash by hand: never automatic,
// always flagged in the confirmation. Matched against fixed home-relative places.
const reviewTargets = {
  'android-system-images': ['Library/Android/sdk/system-images'],
  'android-avds': ['.android/avd/*.avd'],
  'xcode-archives': ['Library/Developer/Xcode/Archives'],
  'maven-repository': ['.m2/repository'],
  'user-app-caches': ['Library/Caches/*'],
  'user-logs': ['Library/Logs/*'],
};
// Review items that stay blocked, with the way to clean them instead.
const blockedReasons = {
  'downloads': 'Mover a pasta Downloads inteira quebraria o Finder. Use “Mostrar no Finder” e escolha os arquivos.',
  'docker-data': 'Apagar o disco do Docker corrompe containers e volumes. Use os comandos em Detalhes.',
  'ios-simulators': 'Remova simuladores pelo Xcode ou com o comando em Detalhes.',
};
function matches(target, home, rel) {
  const full = path.join(home, rel);
  if (!rel.includes('*')) return target === full;
  if (path.dirname(target) !== path.dirname(full)) return false;
  const [prefix, suffix] = path.basename(full).split('*');
  const name = path.basename(target);
  return name.startsWith(prefix) && name.endsWith(suffix) && name.length > prefix.length + suffix.length;
}
function inside(target, root) {return target === root || root.startsWith(target + path.sep) || target.startsWith(root + path.sep);}
// Cleanup policy for one finding: {allowed, review, reason}.
function policy(finding, home, appRoot) {
  const target = path.resolve(finding.path);
  const deny = reason => ({allowed:false, review:false, reason});
  if (inside(target, appRoot)) return deny('Arquivos do próprio DevClean estão protegidos.');
  if (!finding.size_complete) return deny('O macOS não permitiu ler tudo nesta pasta. Conceda Acesso Total ao Disco ou limpe pelo Finder.');
  if (blockedReasons[finding.rule_id]) return deny(blockedReasons[finding.rule_id]);
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
async function hasMarker(finding) {
  const project = projectOutputs[finding.rule_id];
  if (!project) return true;
  const info = await fs.lstat(path.join(path.dirname(finding.path), project.marker)).catch(() => null);
  return Boolean(info?.isFile());
}
// Files that belong to a target and go to the Trash with it (an AVD's .ini).
async function companions(finding) {
  if (finding.rule_id !== 'android-avds') return [];
  const ini = finding.path.replace(/\.avd$/, '.ini');
  const info = await fs.lstat(ini).catch(() => null);
  return info?.isFile() ? [ini] : [];
}
async function identity(target) {
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
async function prepare(report, home, appRoot, now = Date.now()) {
  const manifest = new Map();
  const findings = await Promise.all(report.findings.map(async f => {
    let {allowed, review, reason} = policy(f, home, appRoot);
    if (allowed && !await hasMarker(f)) [allowed, reason] = [false, 'O arquivo do projeto não existe mais. Analise novamente.'];
    if (allowed) {
      try {manifest.set(f.path, await identity(f.path)); return {...f, cleanup_allowed:true, cleanup_review:review, cleanup_reason:'', auto_clean:!review && isAutomatic(f, now)};}
      catch {reason = 'Caminho indisponível ou contém link simbólico. Analise novamente.';}
    }
    return {...f, cleanup_allowed:false, cleanup_review:false, cleanup_reason:reason, auto_clean:false};
  }));
  return {report:{...report, findings, cleanup_token:crypto.randomUUID()}, manifest};
}
function select(report, indices, token) {
  if (!report || token !== report.cleanup_token) throw new Error('Relatório desatualizado. Analise novamente.');
  if (!Array.isArray(indices) || !indices.length || indices.length > 1000) throw new Error('Seleção inválida.');
  const selected = [...new Set(indices)].map(index => {
    if (!Number.isInteger(index) || index < 0 || !report.findings[index]?.cleanup_allowed) throw new Error('Item não autorizado para limpeza.');
    return report.findings[index];
  });
  for (let i=0;i<selected.length;i++) for(let j=i+1;j<selected.length;j++) {
    const a=selected[i].path, b=selected[j].path;
    if (a===b || a.startsWith(b+path.sep) || b.startsWith(a+path.sep)) throw new Error('A seleção contém diretórios sobrepostos.');
  }
  return selected;
}
async function validate(selected, manifest) {
  for (const f of selected) {
    if (!manifest.has(f.path) || await identity(f.path) !== manifest.get(f.path)) throw new Error(`O diretório mudou desde a análise: ${f.path}. Analise novamente.`);
  }
}
async function moveToTrash(selected, manifest, trashItem) {
  await validate(selected, manifest);
  const moved=[], errors=[];
  for (const f of selected) {
    try {
      await validate([f], manifest);
      const extra = await companions(f);
      await trashItem(f.path);
      manifest.delete(f.path);
      for (const file of extra) await trashItem(file).catch(() => {});
      moved.push({path:f.path, size_bytes:f.size_bytes});
    } catch (error) {errors.push({path:f.path, message:error.message});}
  }
  return {moved, errors};
}
function remainingReport(report, moved) {
  const removed = new Set(moved.map(f=>f.path));
  const findings = report.findings.filter(f=>!removed.has(f.path));
  return {...report, findings, totals:buildTotals(findings), cleanup_token:crypto.randomUUID()};
}
module.exports = {STALE_DAYS, prepare, select, validate, moveToTrash, remainingReport};
