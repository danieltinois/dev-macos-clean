const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const targets = {
  'homebrew-cache': 'Library/Caches/Homebrew',
  'pip-cache': 'Library/Caches/pip',
  'cargo-cache': '.cargo/registry/cache',
  'npm-cache': '.npm/_cacache',
  'gradle-cache': '.gradle/caches',
  'pnpm-cache': 'Library/Caches/pnpm',
  'yarn-cache': 'Library/Caches/Yarn',
  'xcode-derived-data': 'Library/Developer/Xcode/DerivedData',
};
function eligible(finding, home, appRoot) {
  if (finding.severity !== 'SAFE' || !finding.reclaimable || !finding.size_complete) return false;
  const target = path.resolve(finding.path);
  if (target === appRoot || appRoot.startsWith(target + path.sep) || target.startsWith(appRoot + path.sep)) return false;
  if (finding.rule_id === 'node-modules') return path.basename(target) === 'node_modules' && finding.metadata?.['package.json'] === 'yes' && target !== path.join(home, 'node_modules');
  return Boolean(targets[finding.rule_id]) && target === path.join(home, targets[finding.rule_id]);
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
  if (!stat.isDirectory()) throw new Error('O alvo não é um diretório.');
  return `${await fs.realpath(resolved)}:${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}`;
}
async function prepare(report, home, appRoot) {
  const manifest = new Map();
  const findings = await Promise.all(report.findings.map(async f => {
    let reason = 'Somente caches regeneráveis de baixo risco podem ser limpos.';
    if (eligible(f, home, appRoot)) {
      try {manifest.set(f.path, await identity(f.path)); return {...f, cleanup_allowed:true, cleanup_reason:''};}
      catch {reason = 'Caminho indisponível ou contém link simbólico. Analise novamente.';}
    } else if (f.path === appRoot || f.path.startsWith(appRoot + path.sep)) reason = 'Arquivos do próprio DevClean estão protegidos.';
    return {...f, cleanup_allowed:false, cleanup_reason:reason};
  }));
  return {report:{...report, findings, cleanup_token:crypto.randomUUID()}, manifest};
}
function select(report, indices, token) {
  if (!report || token !== report.cleanup_token) throw new Error('Relatório desatualizado. Analise novamente.');
  if (!Array.isArray(indices) || !indices.length || indices.length > 200) throw new Error('Seleção inválida.');
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
      await trashItem(f.path);
      manifest.delete(f.path);
      moved.push({path:f.path, size_bytes:f.size_bytes});
    } catch (error) {errors.push({path:f.path, message:error.message});}
  }
  return {moved, errors};
}
function remainingReport(report, moved) {
  const removed = new Set(moved.map(f=>f.path));
  const findings = report.findings.filter(f=>!removed.has(f.path));
  const totals = {findings:findings.length, bytes:0, by_severity:{SAFE:0,REVIEW:0,DANGER:0}, by_category:{}};
  for(const f of findings) {totals.bytes+=f.size_bytes;totals.by_severity[f.severity]+=f.size_bytes;totals.by_category[f.category]=(totals.by_category[f.category]||0)+f.size_bytes;}
  return {...report, findings, totals, cleanup_token:crypto.randomUUID()};
}
module.exports = {prepare, select, validate, moveToTrash, remainingReport};
