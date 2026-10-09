// Rule parsing and validation.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {loadRules, RuleError} = require('./rules.cjs');
const {tempDir} = require('./test-support.cjs');

const EXPECTED_IDS = ['node-modules', 'npm-cache', 'pnpm-cache', 'yarn-cache', 'xcode-derived-data', 'gradle-cache', 'android-system-images', 'android-avds'];
const BASE = {id: 'x', name: 'X', category: 'c', severity: 'SAFE', reclaimable: true, description: 'd'};

function writeRule(dir, name, rule) {fs.writeFileSync(path.join(dir, name), JSON.stringify(rule));}
function rejects(t, rule, message) {
  const dir = tempDir(t);
  writeRule(dir, 'bad.json', rule);
  assert.throws(() => loadRules(dir), error => error instanceof RuleError && message.test(error.message));
}

test('loads all packaged rules with unique ids', () => {
  const ids = loadRules().map(rule => rule.id);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of EXPECTED_IDS) assert.ok(ids.includes(id), id);
});

test('node_modules rule is pattern based', () => {
  const rule = loadRules().find(rule => rule.id === 'node-modules');
  assert.deepEqual(rule.patterns, ['**/node_modules']);
  assert.equal(rule.severity, 'SAFE');
  assert.equal(rule.reclaimable, true);
  assert.ok(rule.rebuild);
  assert.deepEqual(rule.rebuild.commands, []);
});

test('AVD rule uses a glob path and needs review', () => {
  const rule = loadRules().find(rule => rule.id === 'android-avds');
  assert.ok(rule.paths.some(entry => entry.includes('*.avd')));
  assert.equal(rule.severity, 'REVIEW');
  assert.equal(rule.reclaimable, false);
});

test('invalid severity is rejected', t => rejects(t, {...BASE, severity: 'VERY_SAFE', paths: ['/x']}, /severity/));
test('unknown key is rejected', t => rejects(t, {...BASE, paths: ['/x'], typo_field: 1}, /typo_field/));
test('rule without target is rejected', t => rejects(t, BASE, /paths or patterns/));
test('non-slug id is rejected', t => rejects(t, {...BASE, id: 'Bad Id', paths: ['/x']}, /id/));
test('unknown rebuild key is rejected', t => rejects(t, {...BASE, paths: ['/x'], rebuild: {description: 'd', run: 'x'}}, /rebuild/));
test('markers need patterns', t => rejects(t, {...BASE, paths: ['/x'], markers: ['Cargo.toml']}, /markers/));
test('markers must be plain names', t => rejects(t, {...BASE, patterns: ['**/target'], markers: ['../x']}, /markers/));

test('invalid JSON is rejected', t => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'bad.json'), '{"id": ');
  assert.throws(() => loadRules(dir), /invalid JSON/);
});

test('duplicate ids are rejected', t => {
  const dir = tempDir(t);
  writeRule(dir, 'a.json', {...BASE, id: 'dup', paths: ['/x']});
  writeRule(dir, 'b.json', {...BASE, id: 'dup', paths: ['/x']});
  assert.throws(() => loadRules(dir), /duplicate rule ids/);
});

test('missing rules directory is reported', t => {
  assert.throws(() => loadRules(path.join(tempDir(t), 'does-not-exist')), /rules directory not found/);
});
