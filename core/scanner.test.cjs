// End-to-end scanner behavior: discovery, filters, caps, symlinks, permissions, enrichment, totals.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const filesystem = require('./filesystem.cjs');
const {buildTotals} = require('./analyzer.cjs');
const {loadRules, validateRule} = require('./rules.cjs');
const {scan} = require('./scanner.cjs');
const {buildTree, tempDir, block} = require('./test-support.cjs');

const RULES = loadRules();
const rule = fields => validateRule({name: 'Test', category: 'node', severity: 'SAFE', reclaimable: true, description: 'd', ...fields});

function makeHome(t) {
  const home = path.join(tempDir(t), 'home');
  buildTree(home, {
    'projects/a/package.json': 50,
    'projects/a/package-lock.json': 60,
    'projects/a/node_modules/pkg/index.js': 100,
    'projects/a/node_modules/pkg/dep.js': 100,
    'projects/b/package.json': 50,
    'projects/b/yarn.lock': 60,
    'projects/b/node_modules/x/y.js': 100,
    'projects/c/package.json': 50,
    // must never be discovered: hidden / vcs / already-matched dirs
    '.hidden/projects/h/node_modules/y': 10,
    '.git/something/node_modules/z': 10,
    'projects/a/node_modules/pkg/node_modules/internal/x': 10,
    // macOS-style paths probed directly by rules
    'Library/Developer/Xcode/DerivedData/App-abc/Build/x.app/one': 500,
    'Library/Caches/pnpm/store/v3/x': 44,
    'Library/Caches/Yarn/v6/x': 33,
    'Library/Android/sdk/system-images/android-35/arm64/system.img': 200,
    '.gradle/caches/modules-2/files/x/y/z.jar': 300,
    '.npm/_cacache/content-v2/x': 40,
    '.android/avd/pixel.avd/userdata-qemu.img': 50,
    '.android/avd/pixel.avd/emulator-user.ini': 20,
    '.android/avd/nexus.avd/config.ini': 20,
  });
  return home;
}

function counts(report) {
  const result = {};
  for (const finding of report.findings) result[finding.rule_id] = (result[finding.rule_id] ?? 0) + 1;
  return result;
}

test('full scan detects everything', t => {
  const report = scan(RULES, {home: makeHome(t)});
  assert.deepEqual(counts(report), {'node-modules': 2, 'npm-cache': 1, 'pnpm-cache': 1, 'yarn-cache': 1, 'xcode-derived-data': 1, 'gradle-cache': 1, 'android-system-images': 1, 'android-avds': 2});
  assert.ok(!report.findings.some(f => f.path.includes('.hidden') || f.path.includes('.git')));
  for (const finding of report.findings) assert.ok(finding.last_modified);
  // 1517 = node 427 (a=210 incl. the nested internal file, b=100, caches 40+44+33)
  //        + xcode 500 + android 590 (gradle 300, images 200, avds 90)
  assert.deepEqual(report.totals, {findings: 10, bytes: 1517, by_severity: {SAFE: 1227, REVIEW: 290, DANGER: 0}, by_category: {android: 590, node: 427, xcode: 500}});
  assert.deepEqual(report.warnings, []);
  assert.equal(report.schema_version, 1);
});

test('node_modules findings carry project metadata', t => {
  const home = makeHome(t);
  buildTree(home, {'bare/node_modules/x': 1});
  const byProject = Object.fromEntries(scan(RULES, {home, categories: ['node']}).findings
    .filter(f => f.rule_id === 'node-modules').map(f => [path.basename(f.metadata.project), f.metadata]));
  assert.deepEqual(byProject.a, {project: path.join(home, 'projects/a'), 'package.json': 'yes', lockfile: 'package-lock.json', package_manager: 'npm'});
  assert.equal(byProject.b.package_manager, 'yarn');
  assert.deepEqual(byProject.bare, {project: path.join(home, 'bare'), 'package.json': 'no', lockfile: 'none', package_manager: 'unknown'});
});

test('category filter', t => {
  const report = scan(RULES, {home: makeHome(t), categories: ['node']});
  assert.deepEqual(counts(report), {'node-modules': 2, 'npm-cache': 1, 'pnpm-cache': 1, 'yarn-cache': 1});
});

test('unknown category yields an empty report with a warning', t => {
  const report = scan(RULES, {home: makeHome(t), categories: ['nonsense']});
  assert.deepEqual(report.findings, []);
  assert.match(report.warnings[0], /no rules match/);
});

test('excludes skip matching targets', t => {
  const result = counts(scan(RULES, {home: makeHome(t), excludes: ['node_modules']}));
  assert.equal(result['node-modules'], undefined);
  assert.equal(result['xcode-derived-data'], 1);
});

test('maxDepth limits pattern discovery only', t => {
  const result = counts(scan(RULES, {home: makeHome(t), maxDepth: 2}));
  assert.equal(result['node-modules'], undefined); // all node_modules live at depth 3
  assert.equal(result['xcode-derived-data'], 1);
});

test('maxFindings caps and warns', t => {
  const report = scan(RULES, {home: makeHome(t), maxFindings: 1});
  assert.equal(report.findings.length, 1);
  assert.ok(report.warnings.some(warning => warning.includes('reached max findings')));
});

test('node_modules is not re-entered', t => {
  const home = tempDir(t);
  buildTree(home, {'p/node_modules/pkg/node_modules/internal/deep.js': 10});
  const report = scan(RULES, {home});
  assert.deepEqual(report.findings.map(f => f.path), [path.join(home, 'p/node_modules')]);
});

test('explicit paths win over patterns', t => {
  const home = tempDir(t);
  buildTree(home, {'projects/a/package.json': 50, 'projects/a/node_modules/x': 100});
  const target = path.join(home, 'projects/a/node_modules');
  const report = scan([rule({id: 'node-modules', patterns: ['**/node_modules']}), rule({id: 'paths-rule', paths: [target]})], {home});
  assert.deepEqual(report.findings.map(f => f.rule_id), ['paths-rule']);
});

test('a root that matches a pattern is found', t => {
  const home = tempDir(t);
  buildTree(home, {'node_modules/x/y': 10});
  assert.deepEqual(scan(RULES, {home}).findings.map(f => f.path), [path.join(home, 'node_modules')]);
});

test('nonexistent rule paths are ignored', t => {
  const report = scan([rule({id: 'missing', paths: ['~/does/not/exist']})], {home: tempDir(t)});
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.warnings, []);
});

test('scan tolerates permission errors', t => {
  const home = makeHome(t);
  if (!block(t, path.join(home, 'projects/b'))) return;
  const report = scan(RULES, {home});
  assert.equal(counts(report)['node-modules'], 1); // project a still found
  assert.equal(counts(report)['xcode-derived-data'], 1);
  assert.ok(report.warnings.some(warning => warning.startsWith(`cannot read ${path.join(home, 'projects/b')}`)));
});

test('scan is symlink-loop safe', t => {
  const home = tempDir(t);
  buildTree(home, {'projects/a/node_modules/x/y': 10});
  fs.symlinkSync(home, path.join(home, 'projects', 'loop'));
  assert.equal(counts(scan(RULES, {home}))['node-modules'], 1);
});

test('extra roots are scanned', t => {
  const base = tempDir(t);
  const home = path.join(base, 'home'), extra = path.join(base, 'extra');
  buildTree(home, {'package.json': 10});
  buildTree(extra, {'side/node_modules/x': 100});
  const report = scan(RULES, {home, roots: [extra]});
  assert.deepEqual(report.roots, [home, extra]);
  assert.ok(report.findings.some(f => f.path === path.join(extra, 'side/node_modules')));
});

test('missing root is reported, not fatal', t => {
  const home = tempDir(t);
  const report = scan(RULES, {home, roots: [path.join(home, 'nope')]});
  assert.ok(report.warnings.some(warning => warning.includes('scan root does not exist')));
});

test('global scan adds other homes and the disk root', t => {
  const home = makeHome(t);
  const users = tempDir(t);
  buildTree(users, {'other/Library/Caches/Yarn/x': 7, 'Shared': null});
  fs.symlinkSync(home, path.join(users, 'linked'));
  const visited = {};
  t.mock.method(filesystem, 'iterMatches', function* (roots, patterns, options) {
    visited.roots = roots;
    visited.excludes = options.excludes;
  });
  const report = scan(RULES, {home, globalScan: true, usersDir: users});
  assert.deepEqual(visited.roots, [home, path.join(users, 'Shared'), path.join(users, 'other'), '/']);
  assert.ok(visited.excludes.includes('/System'));
  assert.equal(report.options.global_scan, true);
  assert.ok(report.findings.some(f => f.rule_id === 'yarn-cache' && f.path.startsWith(path.join(users, 'other'))));
  assert.ok(!counts(report)['user-app-caches']); // known cache rules keep their identity
});

test('markers only match real Cargo projects', t => {
  const home = tempDir(t);
  buildTree(home, {'code/crate/Cargo.toml': 10, 'code/crate/target/debug/app': 400, 'code/web/target/output.txt': 20});
  const targets = scan(RULES, {home, categories: ['rust']}).findings.filter(f => f.rule_id === 'rust-target');
  assert.deepEqual(targets.map(f => f.path), [path.join(home, 'code/crate/target')]);
  assert.equal(targets[0].size_bytes, 400);
  assert.equal(targets[0].metadata['Cargo.toml'], 'yes');
});

test('newer developer caches are detected and win over the generic cache rule', t => {
  const home = tempDir(t);
  buildTree(home, {
    'Library/Developer/Xcode/iOS DeviceSupport/17.0/Symbols/x': 70,
    'Library/Developer/CoreSimulator/Devices/ABC/data/x': 30,
    'Library/Caches/CocoaPods/Pods/x': 20,
    'Library/Caches/go-build/aa/x': 10,
    'Library/Caches/JetBrains/IntelliJIdea2024.1/x': 15,
    'Library/Caches/ms-playwright/chromium-1/x': 25,
    'Library/Caches/Google/AndroidStudio2024.1/x': 5,
    '.bun/install/cache/x': 5,
  });
  const findings = scan(RULES, {home}).findings;
  const byRule = Object.fromEntries(findings.map(f => [f.rule_id, f]));
  assert.equal(byRule['xcode-device-support'].severity, 'SAFE');
  assert.equal(byRule['ios-simulators'].severity, 'REVIEW');
  for (const id of ['cocoapods-cache', 'go-build-cache', 'jetbrains-caches', 'playwright-browsers', 'bun-cache']) assert.equal(byRule[id].severity, 'SAFE', id);
  const generic = new Set(findings.filter(f => f.rule_id === 'user-app-caches').map(f => path.basename(f.path)));
  for (const name of ['CocoaPods', 'go-build', 'JetBrains', 'ms-playwright']) assert.ok(!generic.has(name), name);
});

test('buildTotals aggregates by severity and category', () => {
  const finding = (severity, category, size_bytes) => ({severity, category, size_bytes});
  assert.deepEqual(buildTotals([finding('SAFE', 'node', 100), finding('REVIEW', 'node', 200), finding('DANGER', 'xcode', 300), finding('SAFE', 'node', 50)]),
    {findings: 4, bytes: 650, by_severity: {SAFE: 150, REVIEW: 200, DANGER: 300}, by_category: {node: 350, xcode: 300}});
});
