// Rule parsing and validation.
import {afterEach, test} from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadRules} from './node';
import {RuleError} from './rules';
import {removeTempDirs, tempDir} from './test-support';

afterEach(removeTempDirs);

const EXPECTED_IDS = ['node-modules', 'npm-cache', 'pnpm-cache', 'yarn-cache', 'xcode-derived-data', 'gradle-cache', 'android-system-images', 'android-avds'];
const BASE = {id: 'x', name: 'X', category: 'c', severity: 'SAFE', reclaimable: true, description: 'd'};

function writeRule(dir: string, name: string, rule: object) {fs.writeFileSync(path.join(dir, name), JSON.stringify(rule));}
function rejects(rule: object, message: RegExp) {
  const dir = tempDir();
  writeRule(dir, 'bad.json', rule);
  assert.throws(() => loadRules(dir), (error: Error) => error instanceof RuleError && message.test(error.message));
}

test('loads all packaged rules with unique ids', () => {
  const ids = loadRules().map(rule => rule.id);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of EXPECTED_IDS) assert.ok(ids.includes(id), id);
});

test('node_modules rule is pattern based', () => {
  const rule = loadRules().find(rule => rule.id === 'node-modules')!;
  assert.deepEqual(rule.patterns, ['**/node_modules']);
  assert.equal(rule.severity, 'SAFE');
  assert.equal(rule.reclaimable, true);
  assert.ok(rule.rebuild);
  assert.deepEqual(rule.rebuild.commands, []);
});

test('AVD rule uses a glob path and needs review', () => {
  const rule = loadRules().find(rule => rule.id === 'android-avds')!;
  assert.ok(rule.paths.some(entry => entry.includes('*.avd')));
  assert.equal(rule.severity, 'REVIEW');
  assert.equal(rule.reclaimable, false);
});

test('invalid severity is rejected', () => rejects({...BASE, severity: 'VERY_SAFE', paths: ['/x']}, /severity/));
test('unknown key is rejected', () => rejects({...BASE, paths: ['/x'], typo_field: 1}, /typo_field/));
test('rule without target is rejected', () => rejects(BASE, /paths or patterns/));
test('non-slug id is rejected', () => rejects({...BASE, id: 'Bad Id', paths: ['/x']}, /id/));
test('unknown rebuild key is rejected', () => rejects({...BASE, paths: ['/x'], rebuild: {description: 'd', run: 'x'}}, /rebuild/));
test('markers need patterns', () => rejects({...BASE, paths: ['/x'], markers: ['Cargo.toml']}, /markers/));
test('markers must be plain names', () => rejects({...BASE, patterns: ['**/target'], markers: ['../x']}, /markers/));

test('invalid JSON is rejected', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'bad.json'), '{"id": ');
  assert.throws(() => loadRules(dir), /invalid JSON/);
});

test('duplicate ids are rejected', () => {
  const dir = tempDir();
  writeRule(dir, 'a.json', {...BASE, id: 'dup', paths: ['/x']});
  writeRule(dir, 'b.json', {...BASE, id: 'dup', paths: ['/x']});
  assert.throws(() => loadRules(dir), /duplicate rule ids/);
});

test('missing rules directory is reported', () => {
  assert.throws(() => loadRules(path.join(tempDir(), 'does-not-exist')), /rules directory not found/);
});
