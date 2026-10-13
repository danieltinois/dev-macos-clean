// The engine must stay portable: no Node/Bun APIs outside the Node adapter.
import {test} from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CORE = import.meta.dirname;
// The Node adapter, the Node-bound public API (index.ts) and test helpers.
const ADAPTERS = new Set(['node.ts', 'index.ts', 'test-support.ts']);

test('core modules use no Node or Bun APIs outside the Node adapter', () => {
  const sources = fs.readdirSync(CORE).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts') && !ADAPTERS.has(name));
  for (const name of sources) {
    const source = fs.readFileSync(path.join(CORE, name), 'utf8');
    assert.doesNotMatch(source, /from ['"](node:|bun)|\bprocess\.|\bBun\.|import\.meta/, name);
    assert.doesNotMatch(source, /from ['"]\.\/node['"]/, `${name} must not import the Node adapter`);
  }
});

test('the engine bundles for a non-Node runtime', async () => {
  const result = await Bun.build({entrypoints: [path.join(CORE, 'engine.ts')], target: 'browser', format: 'iife'});
  assert.ok(result.success, result.logs.join('\n'));
  const code = await result.outputs[0]!.text();
  assert.doesNotMatch(code, /require\(|node:/);
});
