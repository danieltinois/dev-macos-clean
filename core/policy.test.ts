// Cleanup policy (what may be moved, what is automatic) and the helpers the
// native shells use around it. Identity checks and the move itself live in
// apple/DevCleanKit (Cleanup.swift) and are tested there.
import {afterEach, test} from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {nodeHost} from './node';
import * as policy from './policy';
import {buildTree, removeTempDirs, tempDir} from './test-support';
import type {Finding} from './types';

afterEach(removeTempDirs);

const DAY = 86400000, NOW = Date.parse('2026-10-08T00:00:00Z');

function setup() {
  const home = tempDir(), app = path.join(home, 'app'), target = path.join(home, '.npm/_cacache');
  buildTree(home, {'.npm/_cacache/cache': 5});
  const finding = {rule_id: 'npm-cache', name: 'npm', description: '', path: target, severity: 'SAFE', reclaimable: true, size_complete: true,
    size_bytes: 5, category: 'node', last_modified: null, rebuild: null, metadata: {}} as Finding;
  const allowed = (f: Finding) => policy.policy(nodeHost, f, home, app).allowed;
  const mkdir = (rel: string) => {const dir = path.join(home, rel);fs.mkdirSync(dir, {recursive: true});return dir;};
  return {home, app, target, finding, allowed, mkdir};
}

test('blocks arbitrary paths, review, danger, partial measurements and own dependencies', () => {
  const {home, app, finding, allowed, mkdir} = setup();
  const own = mkdir('app/node_modules');
  assert.equal(allowed(finding), true);
  for (const f of [{...finding, path: home}, {...finding, severity: 'REVIEW' as const}, {...finding, severity: 'DANGER' as const}, {...finding, size_complete: false}, {...finding, rule_id: 'node-modules', path: own}]) {
    const decision = policy.policy(nodeHost, f, home, app);
    assert.equal(decision.allowed, false, f.path);
    assert.ok((decision.reason ?? '').length > 10);
  }
});

test('allows Cargo targets and every Device Support folder, but only with real markers', () => {
  const {home, finding, allowed, mkdir} = setup();
  const target = mkdir('code/crate/target'), support = mkdir('Library/Developer/Xcode/watchOS DeviceSupport');
  const rust = {...finding, rule_id: 'rust-target', path: target, metadata: {'Cargo.toml': 'yes'}};
  assert.equal(allowed(rust), false, 'metadata alone is not enough');
  assert.equal(allowed({...finding, rule_id: 'xcode-device-support', path: support}), true);
  fs.writeFileSync(path.join(home, 'code/crate/Cargo.toml'), '[package]');
  assert.equal(allowed(rust), true);
  assert.equal(allowed({...finding, rule_id: 'xcode-device-support', path: path.join(home, 'Library/Developer/Xcode')}), false);
});

test('versioned Android Studio caches match only direct children with the prefix', () => {
  const {finding, allowed, mkdir} = setup();
  const cases: [string, boolean][] = [['Library/Caches/Google/AndroidStudio2026.2', true], ['Library/Caches/Google/AndroidStudio', false], ['Library/Caches/Google/Chrome', false], ['Library/Caches/Google/AndroidStudio2026.2/x', false]];
  assert.deepEqual(cases.map(([rel]) => allowed({...finding, rule_id: 'jetbrains-caches', path: mkdir(rel)})), cases.map(([, ok]) => ok));
});

test('automatic cleanup covers self-recreating caches and stale projects only', () => {
  const {finding, allowed, mkdir, home} = setup();
  const project = (name: string) => {const dir = mkdir(`code/${name}/node_modules`);fs.writeFileSync(path.join(home, `code/${name}/package.json`), '{}');return dir;};
  const node = {...finding, rule_id: 'node-modules', metadata: {'package.json': 'yes'}};
  const findings: Finding[] = [
    finding,
    {...node, path: project('old'), last_modified: new Date(NOW - 120 * DAY).toISOString()},
    {...node, path: project('active'), last_modified: new Date(NOW - 5 * DAY).toISOString()},
    {...node, path: project('unknown'), last_modified: null},
    {...finding, rule_id: 'jetbrains-caches', path: mkdir('Library/Caches/JetBrains')},
  ];
  assert.deepEqual(findings.map(allowed), [true, true, true, true, true]);
  assert.deepEqual(findings.map(f => policy.isAutomatic(f, NOW)), [true, true, false, false, false]);
});

test('review items can be selected by hand but never automatically; risky ones stay blocked', () => {
  const {home, app, finding, mkdir} = setup();
  const review = {...finding, severity: 'REVIEW' as const, reclaimable: false};
  const avd = mkdir('.android/avd/Pixel.avd');fs.writeFileSync(path.join(home, '.android/avd/Pixel.ini'), 'path=');
  mkdir('Library/Caches');const appCacheFile = path.join(home, 'Library/Caches/thumb.png');fs.writeFileSync(appCacheFile, 'png');
  const findings: Finding[] = [
    {...review, rule_id: 'android-avds', path: avd},
    {...review, rule_id: 'user-app-caches', path: mkdir('Library/Caches/com.spotify.client')},
    {...review, rule_id: 'user-app-caches', path: appCacheFile},
    {...review, rule_id: 'user-logs', path: mkdir('Library/Logs/DiagnosticReports')},
    {...review, rule_id: 'downloads', path: mkdir('Downloads')},
    {...review, rule_id: 'user-app-caches', path: mkdir('Library/Caches/CloudKit'), size_complete: false},
    {...review, rule_id: 'user-app-caches', path: mkdir('Library/Caches/a/b')},
    {...review, rule_id: 'android-avds', path: mkdir('.android/avd/notes')},
    {...finding, rule_id: 'node-modules', path: '/opt/homebrew/lib/node_modules', metadata: {'package.json': 'yes'}},
  ];
  const decisions = findings.map(f => policy.policy(nodeHost, f, home, app));
  assert.deepEqual(decisions.map(d => d.allowed), [true, true, true, true, false, false, false, false, false]);
  assert.ok(decisions.filter(d => d.allowed).every(d => d.review));
  assert.ok(findings.every(f => !policy.isAutomatic(f, NOW) || f.severity === 'SAFE'));
  // An AVD goes with its .ini file.
  assert.deepEqual(policy.companions(nodeHost, findings[0]!), [path.join(home, '.android/avd/Pixel.ini')]);
});

test('selection takes valid indices of allowed, non-overlapping items only', () => {
  const {finding} = setup();
  const item = (rel: string, cleanup_allowed = true) => ({...finding, path: finding.path + rel, cleanup_allowed});
  const findings = [item(''), item('2'), item('/inner'), item('3', false)];
  assert.deepEqual(policy.select(findings, [1, 0, 1]).map(f => f.path), [finding.path + '2', finding.path]);
  for (const indices of [[], [-1], [999], ['0'], [0.5], 'x', [3], [0, 2]]) assert.throws(() => policy.select(findings, indices), /./, JSON.stringify(indices));
});

test('moved items leave the report and the totals', () => {
  const {finding} = setup();
  const other = {...finding, path: finding.path + '2', size_bytes: 7};
  const remaining = policy.withoutMoved({findings: [finding, other], warnings: []}, [{path: finding.path}]);
  assert.deepEqual(remaining.findings.map(f => f.path), [other.path]);
  assert.equal(remaining.totals.bytes, 7);
});
