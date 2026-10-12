import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {pick, visible, type Filters} from './selection';
import type {CleanupFinding} from './cleanup';

const finding = (path: string, fields: Partial<CleanupFinding> = {}) => ({
  rule_id: 'npm-cache', name: 'Cache', category: 'node', severity: 'SAFE', reclaimable: true, description: '', path,
  size_bytes: 1, size_complete: true, last_modified: null, rebuild: null, metadata: {},
  cleanup_allowed: true, cleanup_review: false, cleanup_reason: '', auto_clean: false, ...fields,
}) as CleanupFinding;
const NONE: Filters = {query: '', category: '', severity: ''};

const findings = [
  finding('/h/.npm/_cacache'),
  finding('/h/Library/Developer/Xcode/DerivedData', {category: 'xcode', name: 'Derived Data'}),
  finding('/h/.android/avd/a.avd', {category: 'android', severity: 'REVIEW', cleanup_review: true}),
  finding('/h/Downloads', {category: 'downloads', severity: 'REVIEW', cleanup_allowed: false}),
];

test('visible applies category, severity and text filters and keeps report indices', () => {
  assert.deepEqual(visible(findings, NONE).map(f => f.index), [0, 1, 2, 3]);
  assert.deepEqual(visible(findings, {...NONE, category: 'xcode'}).map(f => f.index), [1]);
  assert.deepEqual(visible(findings, {...NONE, severity: 'REVIEW'}).map(f => f.index), [2, 3]);
  assert.deepEqual(visible(findings, {...NONE, query: 'derived'}).map(f => f.index), [1]);
  assert.deepEqual(visible(findings, {...NONE, query: '.ANDROID'}).map(f => f.index), [2]);
});

test('selecting all only picks cleanable items inside the current filter', () => {
  assert.deepEqual(pick(visible(findings, NONE), () => true), [0, 2, 1]);
  assert.deepEqual(pick(visible(findings, {...NONE, category: 'xcode'}), () => true), [1]);
  assert.deepEqual(pick(visible(findings, {...NONE, severity: 'REVIEW'}), () => true), [2]);
  assert.deepEqual(pick(visible(findings, {...NONE, category: 'downloads'}), () => true), []);
});

test('pick skips items inside an already picked folder', () => {
  const nested = [finding('/h/Library/Caches/a/b'), finding('/h/Library/Caches/a'), finding('/h/Library/Caches/ab')];
  assert.deepEqual(pick(visible(nested, NONE), () => true), [1, 2]);
});
