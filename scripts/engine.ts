// Bundles the portable engine (core/jsc.ts) with the rule files embedded, as one
// browser-style script for JavaScriptCore. Used by build.ts, the Xcode build
// phase (`bun run build:engine`) and core/jsc.test.ts.
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
export const ENGINE_FILE = path.join(root, 'dist', 'engine', 'devclean-engine.js');

export async function bundleEngine(rulesDir = path.join(root, 'rules')): Promise<string> {
  const names = (await fs.readdir(rulesDir)).filter(name => name.endsWith('.json')).sort();
  const files = await Promise.all(names.map(async name => ({name, text: await fs.readFile(path.join(rulesDir, name), 'utf8')})));
  const result = await Bun.build({
    entrypoints: [path.join(root, 'core', 'jsc.ts')], target: 'browser', format: 'iife',
    define: {DEVCLEAN_RULE_FILES: JSON.stringify(files)},
  });
  if (!result.success) throw new AggregateError(result.logs, 'engine bundle failed');
  return result.outputs[0]!.text();
}

export async function writeEngine(outfile = ENGINE_FILE) {
  await fs.mkdir(path.dirname(outfile), {recursive: true});
  await fs.writeFile(outfile, await bundleEngine());
  return outfile;
}

if (import.meta.main) console.log(`built ${path.relative(root, await writeEngine())}`);
