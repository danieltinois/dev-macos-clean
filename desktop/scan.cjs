const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
function scan(folder) {
  const python = process.env.DEVCLEAN_PYTHON || path.join(root, '.venv/bin/python');
  if (!fs.existsSync(python)) return Promise.reject(new Error('Prepare o Python: python3 -m venv .venv e .venv/bin/pip install -e ".[dev]"'));
  return new Promise((resolve, reject) => {
    const args = ['-m', 'devclean', 'scan', '--json'];
    if (folder) args.push('--home', folder);
    else args.push('--global');
    const child = spawn(python, args, {cwd: root, shell: false});
    let output = '', error = '', settled = false;
    const finish = (err, value) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(value); };
    const timer = setTimeout(() => {child.kill(); finish(new Error('A análise excedeu 5 minutos. Escolha uma pasta menor.'));}, 300000);
    child.stdout.on('data', data => {output += data; if (output.length > 16000000) {child.kill(); finish(new Error('Relatório excedeu o limite de tamanho.'));}});
    child.stderr.on('data', data => {error = (error + data).slice(-8000);});
    child.on('error', err => finish(err));
    child.on('close', code => {
      if (code !== 0) return finish(new Error(error || 'Não foi possível analisar esta pasta.'));
      try {finish(null, JSON.parse(output));} catch {finish(new Error('O analisador retornou um relatório inválido.'));}
    });
  });
}
module.exports = {scan};
