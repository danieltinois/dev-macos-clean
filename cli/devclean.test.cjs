// CLI: exit codes, human output and the stable JSON contract.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {main} = require('./devclean.cjs');
const {buildTree, tempDir} = require('../core/test-support.cjs');

const REQUIRED_FINDING_KEYS = ['rule_id', 'name', 'category', 'severity', 'reclaimable', 'description', 'path', 'size_bytes', 'size_complete', 'last_modified', 'rebuild', 'metadata'];

function makeHome(t) {
  const home = path.join(tempDir(t), 'home');
  buildTree(home, {
    'projects/a/package.json': 50,
    'projects/a/package-lock.json': 60,
    'projects/a/node_modules/pkg/index.js': 100,
    'Library/Developer/Xcode/DerivedData/App/Build/x.app/one': 500,
    '.android/avd/pixel.avd/userdata-qemu.img': 20,
  });
  return home;
}

function run(argv) {
  let stdout = '', stderr = '';
  const code = main(argv, {stdout: {write: text => {stdout += text;}}, stderr: {write: text => {stderr += text;}}});
  return {code, stdout, stderr};
}

test('JSON contract', t => {
  const home = makeHome(t);
  const {code, stdout} = run(['scan', '--home', home, '--json']);
  assert.equal(code, 0);
  const data = JSON.parse(stdout);
  assert.equal(data.schema_version, 1);
  assert.ok(data.scanned_at);
  assert.deepEqual(data.roots, [home]);
  assert.equal(data.totals.findings, 3);
  assert.equal(data.totals.bytes, 620);
  assert.deepEqual(data.totals.by_severity, {SAFE: 600, REVIEW: 20, DANGER: 0});
  for (const finding of data.findings) assert.deepEqual(Object.keys(finding), REQUIRED_FINDING_KEYS);
  const node = data.findings.find(f => f.rule_id === 'node-modules');
  assert.equal(node.metadata.package_manager, 'npm');
  assert.equal(node.metadata['package.json'], 'yes');
  assert.ok(node.last_modified);
  const avd = data.findings.find(f => f.rule_id === 'android-avds');
  assert.equal(avd.severity, 'REVIEW');
  assert.equal(avd.reclaimable, false);
});

test('human output', t => {
  const {code, stdout} = run(['scan', '--home', makeHome(t)]);
  assert.equal(code, 0);
  for (const text of ['Node.js', 'Xcode', 'Android', 'Risk:      SAFE', 'Risk:      REVIEW', '100 B', 'Detected:', 'SAFE: ', 'package_manager: npm', 'Nothing was deleted.']) assert.ok(stdout.includes(text), text);
});

test('category filter', t => {
  const data = JSON.parse(run(['scan', '--home', makeHome(t), '-c', 'node', '--json']).stdout);
  assert.ok(data.findings.length);
  assert.ok(data.findings.every(f => f.category === 'node'));
});

test('exclude', t => {
  const data = JSON.parse(run(['scan', '--home', makeHome(t), '--exclude', 'node_modules', '--json']).stdout);
  assert.ok(data.findings.every(f => f.rule_id !== 'node-modules'));
});

test('unknown category yields an empty report', t => {
  const {code, stdout} = run(['scan', '--home', makeHome(t), '--category', 'nonsense']);
  assert.equal(code, 0);
  assert.ok(stdout.includes('No findings'));
  assert.ok(stdout.includes('Nothing was deleted.'));
});

test('extra root', t => {
  const home = makeHome(t);
  const extra = path.join(path.dirname(home), 'extra');
  buildTree(extra, {'side/node_modules/x/y': 100});
  const data = JSON.parse(run(['scan', '--home', home, extra, '--json']).stdout);
  assert.deepEqual(data.roots, [home, extra]);
  assert.equal(data.totals.bytes, 720);
});

test('usage errors exit with 2', () => {
  assert.equal(run([]).code, 2);
  assert.equal(run(['clean']).code, 2);
  assert.equal(run(['scan', '--bogus']).code, 2);
  assert.equal(run(['scan', '--max-depth', 'x']).code, 2);
  assert.match(run(['--version']).stdout, /^devclean \d/);
});
