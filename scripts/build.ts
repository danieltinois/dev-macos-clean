// Builds the Electron app into dist/. Electron runs its own Node, so the main
// process, preload and scan worker are bundled to CommonJS and the renderer to a
// browser script. Rules and static assets are copied so dist/ is self-contained.
// The engine bundle for the Swift apps (dist/engine/) is built too.
import {cp, rm} from 'node:fs/promises';
import path from 'node:path';
import {writeEngine} from './engine';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist');
const desktop = path.join(root, 'desktop');

await rm(out, {recursive: true, force: true});

async function bundle(options: Bun.BuildConfig) {
  const result = await Bun.build(options);
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

await bundle({
  entrypoints: ['main.ts', 'preload.ts', 'scan-worker.ts'].map(file => path.join(desktop, file)),
  outdir: path.join(out, 'desktop'), target: 'node', format: 'cjs', naming: '[name].cjs', external: ['electron'],
});
await bundle({entrypoints: [path.join(desktop, 'renderer.ts')], outdir: path.join(out, 'desktop'), target: 'browser', format: 'iife'});
for (const file of ['index.html', 'style.css']) await cp(path.join(desktop, file), path.join(out, 'desktop', file));
await cp(path.join(root, 'rules'), path.join(out, 'rules'), {recursive: true});
await writeEngine();
console.log(`built ${path.relative(root, out)}/`);
