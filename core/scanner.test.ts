// End-to-end scanner behavior: discovery, filters, caps, symlinks, permissions, enrichment, totals.
import {afterEach, spyOn, test} from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as filesystem from './filesystem';
import {buildTotals} from './analyzer';
import {loadRules, validateRule} from './rules';
import {scan} from './scanner';
import {buildTree, tempDir, removeTempDirs, block, isRoot} from './test-support';
import type {Report, Severity} from './types';

afterEach(removeTempDirs);

const RULES = loadRules();
const rule = (fields: object) => validateRule({name: 'Test', category: 'node', severity: 'SAFE', reclaimable: true, description: 'd', ...fields});

function makeHome() {
  const home = path.join(tempDir(), 'home');
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

function counts(report: Report) {
  const result: Record<string, number> = {};
  for (const finding of report.findings) result[finding.rule_id] = (result[finding.rule_id] ?? 0) + 1;
  return result;
}

test('full scan detects everything', () => {
  const report = scan(RULES, {home: makeHome()});
  assert.deepEqual(counts(report), {'node-modules': 2, 'npm-cache': 1, 'pnpm-cache': 1, 'yarn-cache': 1, 'xcode-derived-data': 1, 'gradle-cache': 1, 'android-system-images': 1, 'android-avds': 2});
  assert.ok(!report.findings.some(f => f.path.includes('.hidden') || f.path.includes('.git')));
  for (const finding of report.findings) assert.ok(finding.last_modified);
  // 1517 = node 427 (a=210 incl. the nested internal file, b=100, caches 40+44+33)
  //        + xcode 500 + android 590 (gradle 300, images 200, avds 90)
  assert.deepEqual(report.totals, {findings: 10, bytes: 1517, by_severity: {SAFE: 1227, REVIEW: 290, DANGER: 0}, by_category: {android: 590, node: 427, xcode: 500}});
  assert.deepEqual(report.warnings, []);
  assert.equal(report.schema_version, 1);
});

test('node_modules findings carry project metadata', () => {
  const home = makeHome();
  buildTree(home, {'bare/node_modules/x': 1});
  const byProject = Object.fromEntries(scan(RULES, {home, categories: ['node']}).findings
    .filter(f => f.rule_id === 'node-modules').map(f => [path.basename(f.metadata.project!), f.metadata]));
  assert.deepEqual(byProject.a, {project: path.join(home, 'projects/a'), 'package.json': 'yes', lockfile: 'package-lock.json', package_manager: 'npm'});
  assert.equal(byProject.b!.package_manager, 'yarn');
  assert.deepEqual(byProject.bare, {project: path.join(home, 'bare'), 'package.json': 'no', lockfile: 'none', package_manager: 'unknown'});
});

test('bun projects are recognized by either lockfile format', () => {
  const home = tempDir();
  buildTree(home, {'text/package.json': 1, 'text/bun.lock': 1, 'text/node_modules/x': 1, 'binary/package.json': 1, 'binary/bun.lockb': 1, 'binary/node_modules/x': 1});
  const managers = scan(RULES, {home, categories: ['node']}).findings.map(f => [path.basename(f.metadata.project!), f.metadata.lockfile, f.metadata.package_manager]);
  assert.deepEqual(managers, [['binary', 'bun.lockb', 'bun'], ['text', 'bun.lock', 'bun']]);
});

test('category filter', () => {
  const report = scan(RULES, {home: makeHome(), categories: ['node']});
  assert.deepEqual(counts(report), {'node-modules': 2, 'npm-cache': 1, 'pnpm-cache': 1, 'yarn-cache': 1});
});

test('unknown category yields an empty report with a warning', () => {
  const report = scan(RULES, {home: makeHome(), categories: ['nonsense']});
  assert.deepEqual(report.findings, []);
  assert.match(report.warnings[0]!, /no rules match/);
});

test('excludes skip matching targets', () => {
  const result = counts(scan(RULES, {home: makeHome(), excludes: ['node_modules']}));
  assert.equal(result['node-modules'], undefined);
  assert.equal(result['xcode-derived-data'], 1);
});

test('maxDepth limits pattern discovery only', () => {
  const result = counts(scan(RULES, {home: makeHome(), maxDepth: 2}));
  assert.equal(result['node-modules'], undefined); // all node_modules live at depth 3
  assert.equal(result['xcode-derived-data'], 1);
});

test('maxFindings caps and warns', () => {
  const report = scan(RULES, {home: makeHome(), maxFindings: 1});
  assert.equal(report.findings.length, 1);
  assert.ok(report.warnings.some(warning => warning.includes('reached max findings')));
});

test('node_modules is not re-entered', () => {
  const home = tempDir();
  buildTree(home, {'p/node_modules/pkg/node_modules/internal/deep.js': 10});
  const report = scan(RULES, {home});
  assert.deepEqual(report.findings.map(f => f.path), [path.join(home, 'p/node_modules')]);
});

test('explicit paths win over patterns', () => {
  const home = tempDir();
  buildTree(home, {'projects/a/package.json': 50, 'projects/a/node_modules/x': 100});
  const target = path.join(home, 'projects/a/node_modules');
  const report = scan([rule({id: 'node-modules', patterns: ['**/node_modules']}), rule({id: 'paths-rule', paths: [target]})], {home});
  assert.deepEqual(report.findings.map(f => f.rule_id), ['paths-rule']);
});

test('a root that matches a pattern is found', () => {
  const home = tempDir();
  buildTree(home, {'node_modules/x/y': 10});
  assert.deepEqual(scan(RULES, {home}).findings.map(f => f.path), [path.join(home, 'node_modules')]);
});

test('nonexistent rule paths are ignored', () => {
  const report = scan([rule({id: 'missing', paths: ['~/does/not/exist']})], {home: tempDir()});
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.warnings, []);
});

test.skipIf(isRoot)('scan tolerates permission errors', () => {
  const home = makeHome();
  block(path.join(home, 'projects/b'));
  const report = scan(RULES, {home});
  assert.equal(counts(report)['node-modules'], 1); // project a still found
  assert.equal(counts(report)['xcode-derived-data'], 1);
  assert.ok(report.warnings.some(warning => warning.startsWith(`cannot read ${path.join(home, 'projects/b')}`)));
});

test('scan is symlink-loop safe', () => {
  const home = tempDir();
  buildTree(home, {'projects/a/node_modules/x/y': 10});
  fs.symlinkSync(home, path.join(home, 'projects', 'loop'));
  assert.equal(counts(scan(RULES, {home}))['node-modules'], 1);
});

test('extra roots are scanned', () => {
  const base = tempDir();
  const home = path.join(base, 'home'), extra = path.join(base, 'extra');
  buildTree(home, {'package.json': 10});
  buildTree(extra, {'side/node_modules/x': 100});
  const report = scan(RULES, {home, roots: [extra]});
  assert.deepEqual(report.roots, [home, extra]);
  assert.ok(report.findings.some(f => f.path === path.join(extra, 'side/node_modules')));
});

test('missing root is reported, not fatal', () => {
  const home = tempDir();
  const report = scan(RULES, {home, roots: [path.join(home, 'nope')]});
  assert.ok(report.warnings.some(warning => warning.includes('scan root does not exist')));
});

test('global scan adds other homes and the disk root', () => {
  const home = makeHome();
  const users = tempDir();
  buildTree(users, {'other/Library/Caches/Yarn/x': 7, 'Shared': null});
  fs.symlinkSync(home, path.join(users, 'linked'));
  const visited: {roots?: string[]; excludes?: string[]} = {};
  const spy = spyOn(filesystem, 'iterMatches').mockImplementation(function* (roots, _patterns, options) {
    visited.roots = roots;
    visited.excludes = options.excludes;
  });
  try {
    const report = scan(RULES, {home, globalScan: true, usersDir: users});
    assert.deepEqual(visited.roots, [home, path.join(users, 'Shared'), path.join(users, 'other'), '/']);
    assert.ok(visited.excludes!.includes('/System'));
    assert.equal(report.options.global_scan, true);
    assert.ok(report.findings.some(f => f.rule_id === 'yarn-cache' && f.path.startsWith(path.join(users, 'other'))));
    assert.ok(!counts(report)['user-app-caches']); // known cache rules keep their identity
  } finally {spy.mockRestore();}
});

test('markers only match real Cargo projects', () => {
  const home = tempDir();
  buildTree(home, {'code/crate/Cargo.toml': 10, 'code/crate/target/debug/app': 400, 'code/web/target/output.txt': 20});
  const targets = scan(RULES, {home, categories: ['rust']}).findings.filter(f => f.rule_id === 'rust-target');
  assert.deepEqual(targets.map(f => f.path), [path.join(home, 'code/crate/target')]);
  assert.equal(targets[0]!.size_bytes, 400);
  assert.equal(targets[0]!.metadata['Cargo.toml'], 'yes');
});

test('newer developer caches are detected and win over the generic cache rule', () => {
  const home = tempDir();
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
  assert.equal(byRule['xcode-device-support']!.severity, 'SAFE');
  assert.equal(byRule['ios-simulators']!.severity, 'REVIEW');
  for (const id of ['cocoapods-cache', 'go-build-cache', 'jetbrains-caches', 'playwright-browsers', 'bun-cache']) assert.equal(byRule[id]!.severity, 'SAFE', id);
  const generic = new Set(findings.filter(f => f.rule_id === 'user-app-caches').map(f => path.basename(f.path)));
  for (const name of ['CocoaPods', 'go-build', 'JetBrains', 'ms-playwright']) assert.ok(!generic.has(name), name);
});

test('buildTotals aggregates by severity and category', () => {
  const finding = (severity: Severity, category: string, size_bytes: number) => ({severity, category, size_bytes});
  assert.deepEqual(buildTotals([finding('SAFE', 'node', 100), finding('REVIEW', 'node', 200), finding('DANGER', 'xcode', 300), finding('SAFE', 'node', 50)]),
    {findings: 4, bytes: 650, by_severity: {SAFE: 150, REVIEW: 200, DANGER: 300}, by_category: {node: 350, xcode: 300}});
});
