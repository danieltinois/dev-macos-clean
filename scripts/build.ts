// Builds what the Swift apps bundle into dist/: the shared UI (the renderer as a
// browser script, plus index.html and style.css) and the engine for
// JavaScriptCore (dist/engine/, rules embedded). apple/bundle-resources.sh copies both.
import {cp, rm} from 'node:fs/promises';
import path from 'node:path';
import {writeEngine} from './engine';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist');
const ui = path.join(root, 'ui');

await rm(out, {recursive: true, force: true});
const result = await Bun.build({entrypoints: [path.join(ui, 'renderer.ts')], outdir: path.join(out, 'ui'), target: 'browser', format: 'iife'});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const file of ['index.html', 'style.css']) await cp(path.join(ui, file), path.join(out, 'ui', file));
await writeEngine();
console.log(`built ${path.relative(root, out)}/`);
