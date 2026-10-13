// The JavaScriptCore bundle runs in a bare context (no Node globals) and gives
// the same results as the Node-bound engine.
import {afterEach, beforeAll, test} from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import {bundleEngine} from '../scripts/engine';
import {loadRules, nodeHost, scan} from './node';
import * as policy from './policy';
import {buildTree, removeTempDirs, tempDir} from './test-support';
import type {Report} from './types';

afterEach(removeTempDirs);

interface Bridge {
  ruleCount(): number;
  scan(host: typeof nodeHost, options: string): string;
  decide(host: typeof nodeHost, report: string, home: string, appRoot: string, now: number): string;
  select(findings: string, indices: string): string;
  companions(host: typeof nodeHost, finding: string): string;
  remaining(report: string, moved: string): string;
}
let bridge: Bridge;
beforeAll(async () => {
  const context: {DevCleanEngine?: Bridge} = {};
  vm.runInNewContext(await bundleEngine(), context);
  bridge = context.DevCleanEngine!;
});

function fixture() {
  const home = tempDir();
  buildTree(home, {
    'code/web/package.json': 2, 'code/web/node_modules/x/y.js': 100, 'code/crate/Cargo.toml': 1, 'code/crate/target/debug/app': 40,
    '.npm/_cacache/x': 30, 'Library/Caches/com.example/x': 5, 'Downloads/big.zip': 70, '.android/avd/p.avd/img': 9, '.android/avd/p.ini': 1,
  });
  return home;
}
const withoutTime = (report: Report) => ({...report, scanned_at: ''});

test('the bundle needs no Node globals and embeds every rule', () => {
  assert.equal(bridge.ruleCount(), loadRules().length);
});

test('scanning through the bundle matches the Node engine', () => {
  const home = fixture();
  const bundled = JSON.parse(bridge.scan(nodeHost, JSON.stringify({home}))) as Report;
  assert.deepEqual(withoutTime(bundled), withoutTime(scan(loadRules(), {home})));
  assert.ok(bundled.findings.length >= 6);
});

test('cleanup decisions through the bundle match core/policy', () => {
  const home = fixture(), app = path.join(home, 'app'), now = Date.now();
  const report = scan(loadRules(), {home});
  const decisions = JSON.parse(bridge.decide(nodeHost, JSON.stringify(report), home, app, now)) as {allowed: boolean; review: boolean; reason: string; auto: boolean}[];
  assert.deepEqual(decisions, report.findings.map(f => {
    const {allowed, review, reason = ''} = policy.policy(nodeHost, f, home, app);
    return {allowed, review, reason, auto: allowed && !review && policy.isAutomatic(f, now)};
  }));
  assert.ok(decisions.some(d => d.allowed) && decisions.some(d => !d.allowed));
  const avd = report.findings.find(f => f.rule_id === 'android-avds')!;
  assert.deepEqual(JSON.parse(bridge.companions(nodeHost, JSON.stringify(avd))), [path.join(home, '.android/avd/p.ini')]);
});

test('select and remaining go through the bundle', () => {
  const findings = [{path: '/a', cleanup_allowed: true, size_bytes: 1}, {path: '/a/b', cleanup_allowed: true, size_bytes: 2}, {path: '/c', cleanup_allowed: false, size_bytes: 3}];
  assert.deepEqual(JSON.parse(bridge.select(JSON.stringify(findings), '[0,0]')), [findings[0]]);
  assert.throws(() => bridge.select(JSON.stringify(findings), '[0,1]'), /sobrepostos/);
  assert.throws(() => bridge.select(JSON.stringify(findings), '[2]'), /não autorizado/);
  const report = scan(loadRules(), {home: fixture()});
  const rest = JSON.parse(bridge.remaining(JSON.stringify(report), JSON.stringify([report.findings[0]!.path]))) as Report;
  assert.equal(rest.findings.length, report.findings.length - 1);
  assert.equal(rest.totals.bytes, report.totals.bytes - report.findings[0]!.size_bytes);
});
