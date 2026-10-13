// Builds what the Swift apps bundle into dist/: the engine for JavaScriptCore
// (dist/engine/, rules embedded). apple/bundle-resources.sh copies it.
import {rm} from 'node:fs/promises';
import path from 'node:path';
import {writeEngine} from './engine';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist');

await rm(out, {recursive: true, force: true});
await writeEngine();
console.log(`built ${path.relative(root, out)}/`);
