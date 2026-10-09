// Size computation, exclusions, symlinks, permission errors and formatters.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {dirSize, measure, excluded, expandPath, glob, fnmatch, iterMatches} = require('./filesystem.cjs');
const {formatBytes, formatAgo} = require('./format.cjs');
const {makeFile, buildTree, tempDir, block} = require('./test-support.cjs');

const walk = (roots, patterns, options = {}) => [...iterMatches(roots, patterns, {maxDepth: 6, maxDirs: 1000, excludes: [], ...options})].sort();

test('dirSize sums files', t => {
  const dir = tempDir(t);
  buildTree(dir, {'a.txt': 1000, 'sub/b.bin': 2000, 'sub/deep/c': 500});
  assert.deepEqual(dirSize(dir), {bytes: 3500, errors: 0, truncated: false});
});

test('dirSize of an empty directory is zero', t => {
  assert.deepEqual(dirSize(tempDir(t)), {bytes: 0, errors: 0, truncated: false});
});

test('measure handles a file target', t => {
  const file = makeFile(path.join(tempDir(t), 'f.bin'), 1234);
  assert.deepEqual(measure(file), {bytes: 1234, errors: 0, truncated: false});
});

test('measure reports an error for a missing path', t => {
  assert.deepEqual(measure(path.join(tempDir(t), 'nope')), {bytes: 0, errors: 1, truncated: false});
});

test('dirSize respects the entry cap', t => {
  const dir = tempDir(t);
  buildTree(dir, Object.fromEntries(Array.from({length: 10}, (_, i) => [`file${i}.bin`, 100])));
  const result = dirSize(dir, {maxEntries: 3});
  assert.equal(result.truncated, true);
  assert.ok(result.bytes > 0 && result.bytes < 1000);
});

test('dirSize does not follow symlinks', t => {
  const dir = tempDir(t);
  makeFile(path.join(dir, 'real', 'big.bin'), 5000);
  fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'loop'));
  assert.equal(dirSize(dir).bytes, 5000);
});

test('dirSize tolerates permission errors', t => {
  const dir = tempDir(t);
  makeFile(path.join(dir, 'ok.bin'), 300);
  makeFile(path.join(dir, 'blocked', 'secret.bin'), 5000);
  if (!block(t, path.join(dir, 'blocked'))) return;
  assert.deepEqual(dirSize(dir), {bytes: 300, errors: 1, truncated: false});
});

test('excluded matches by basename and full path', () => {
  const target = '/tmp/projects/a/node_modules';
  assert.equal(excluded(target, ['node_modules']), true);
  assert.equal(excluded(target, [target]), true);
  assert.equal(excluded(target, ['*/a/node_modules']), true);
  assert.equal(excluded(target, ['other']), false);
});

test('fnmatch follows shell semantics', () => {
  assert.equal(fnmatch('AndroidStudio2024.1', 'AndroidStudio*'), true);
  assert.equal(fnmatch('a.b', 'a?b'), true);
  assert.equal(fnmatch('x1', 'x[0-9]'), true);
  assert.equal(fnmatch('x1', 'x[!0-9]'), false);
  assert.equal(fnmatch('a.b', 'a+b'), false);
});

test('expandPath uses the injected home and environment', () => {
  assert.equal(expandPath('~', '/h'), '/h');
  assert.equal(expandPath('~/Library/Caches/Yarn', '/h'), '/h/Library/Caches/Yarn');
  assert.equal(expandPath('/abs/path', '/h'), '/abs/path');
  process.env.DEVCLEAN_TEST_VAR = '/env';
  assert.equal(expandPath('$DEVCLEAN_TEST_VAR/x', '/h'), '/env/x');
  assert.equal(expandPath('${DEVCLEAN_TEST_UNSET}/x', '/h'), '${DEVCLEAN_TEST_UNSET}/x');
});

test('glob expands wildcards and skips hidden names', t => {
  const dir = tempDir(t);
  buildTree(dir, {'avd/a.avd': null, 'avd/b.avd': null, 'avd/c.ini': 1, 'Caches/Foo': null, 'Caches/.hidden': null});
  assert.deepEqual(glob(path.join(dir, 'avd', '*.avd')), [path.join(dir, 'avd', 'a.avd'), path.join(dir, 'avd', 'b.avd')]);
  assert.deepEqual(glob(path.join(dir, 'Caches', '*')), [path.join(dir, 'Caches', 'Foo')]);
  assert.deepEqual(glob(path.join(dir, 'missing', '*')), []);
});

test('iterMatches finds and does not descend into matches', t => {
  const dir = tempDir(t);
  buildTree(dir, {'projects/a/node_modules/pkg/one.js': 10, 'projects/a/node_modules/pkg/node_modules/x': 10, 'projects/b/node_modules/x/y.js': 10});
  assert.deepEqual(walk([dir], ['**/node_modules']), [path.join(dir, 'projects/a/node_modules'), path.join(dir, 'projects/b/node_modules')]);
});

test('iterMatches skips hidden and heavy dirs', t => {
  const dir = tempDir(t);
  buildTree(dir, {'.hidden/node_modules/h': 10, '.git/node_modules/g': 10, 'Library/node_modules/lib': 10, 'visible/node_modules/v': 10});
  assert.deepEqual(walk([dir], ['**/node_modules']), [path.join(dir, 'visible/node_modules')]);
});

test('iterMatches respects maxDepth', t => {
  const dir = tempDir(t);
  buildTree(dir, {'lvl1/lvl2/lvl3/node_modules/deep': 10, 'lvl1/lvl2/node_modules/mid': 10});
  assert.deepEqual(walk([dir], ['**/node_modules'], {maxDepth: 2}), []);
  assert.deepEqual(walk([dir], ['**/node_modules'], {maxDepth: 3}), [path.join(dir, 'lvl1/lvl2/node_modules')]);
});

test('iterMatches is symlink-loop safe', t => {
  const dir = tempDir(t);
  buildTree(dir, {'p/node_modules/only/x': 10});
  fs.symlinkSync(dir, path.join(dir, 'p', 'back-to-root'));
  assert.deepEqual(walk([dir], ['**/node_modules']), [path.join(dir, 'p/node_modules')]);
});

test('iterMatches applies excludes', t => {
  const dir = tempDir(t);
  buildTree(dir, {'a/node_modules/x': 10, 'b/node_modules/x': 10});
  assert.deepEqual(walk([dir], ['**/node_modules'], {excludes: ['*/a/node_modules']}), [path.join(dir, 'b/node_modules')]);
});

test('iterMatches stops at maxDirs with a warning', t => {
  const dir = tempDir(t);
  buildTree(dir, {'a/x': null, 'b/x': null, 'c/node_modules': null});
  const warnings = [];
  walk([dir], ['**/node_modules'], {maxDirs: 2, warnings});
  assert.match(warnings[0], /discovery exceeded 2 directories/);
});

test('formatBytes', () => {
  for (const [size, expected] of [[0, '0 B'], [512, '512 B'], [1023, '1023 B'], [1024, '1 KB'], [842 * 1024 ** 2, '842 MB'], [Math.trunc(2.4 * 1024 ** 3), '2.4 GB'], [Math.trunc(31.17 * 1024 ** 3), '31.2 GB']]) {
    assert.equal(formatBytes(size), expected);
  }
  assert.throws(() => formatBytes(-1), RangeError);
});

test('formatAgo boundaries', () => {
  const now = new Date('2026-09-24T12:00:00Z');
  const ago = ms => formatAgo(new Date(now - ms), now);
  const minute = 60000, hour = 60 * minute, day = 24 * hour;
  assert.equal(ago(30000), 'just now');
  assert.equal(ago(minute), '1 minute ago');
  assert.equal(ago(90 * minute), '1 hour ago');
  assert.equal(ago(5 * hour), '5 hours ago');
  assert.equal(ago(3 * day), '3 days ago');
  assert.equal(ago(14 * day), '2 weeks ago');
  assert.equal(ago(100 * day), '3 months ago');
  assert.equal(ago(400 * day), '1 year ago');
  assert.equal(ago(-5 * minute), 'in the future');
});
