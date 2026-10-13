// Size computation, exclusions, symlinks, permission errors and formatters.
import {afterEach, test} from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as filesystem from './filesystem';
import {excluded, fnmatch, type WalkOptions} from './filesystem';
import {nodeHost} from './node';
import {formatBytes, formatAgo} from './format';
import {makeFile, buildTree, tempDir, removeTempDirs, block, isRoot} from './test-support';

afterEach(removeTempDirs);

const dirSize = (target: string, options?: filesystem.SizeOptions) => filesystem.dirSize(nodeHost, target, options);
const measure = (target: string) => filesystem.measure(nodeHost, target);
const glob = (pattern: string) => filesystem.glob(nodeHost, pattern);
const expandPath = (entry: string, home: string) => filesystem.expandPath(entry, home, name => process.env[name]);
const walk = (roots: string[], patterns: string[], options: Partial<WalkOptions> = {}) => [...filesystem.iterMatches(nodeHost, roots, patterns, {maxDepth: 6, maxDirs: 1000, excludes: [], ...options})].sort();

test('dirSize sums files', () => {
  const dir = tempDir();
  buildTree(dir, {'a.txt': 1000, 'sub/b.bin': 2000, 'sub/deep/c': 500});
  assert.deepEqual(dirSize(dir), {bytes: 3500, errors: 0, truncated: false});
});

test('sparse files count what they take on disk, not what they declare', () => {
  // Like a VM disk image (Docker.raw): 1 GiB declared, nothing written yet.
  const root = tempDir(), image = path.join(root, 'vm', 'disk.raw');
  buildTree(root, {'vm/notes.txt': 120});
  const fd = fs.openSync(image, 'w');
  fs.ftruncateSync(fd, 1024 ** 3);
  fs.closeSync(fd);
  assert.equal(fs.statSync(image).size, 1024 ** 3);
  assert.ok(filesystem.measure(nodeHost, image).bytes < 1024 ** 2);
  const total = filesystem.dirSize(nodeHost, path.join(root, 'vm')).bytes;
  assert.ok(total >= 120 && total < 1024 ** 2, String(total));
  // Small files keep their exact size, not a whole block; hosts that can't tell use the size.
  assert.equal(filesystem.measure(nodeHost, path.join(root, 'vm', 'notes.txt')).bytes, 120);
  assert.equal(filesystem.onDisk({kind: 'file', size: 500, mtimeMs: 0}), 500);
});

test('dirSize of an empty directory is zero', () => {
  assert.deepEqual(dirSize(tempDir()), {bytes: 0, errors: 0, truncated: false});
});

test('measure handles a file target', () => {
  const file = makeFile(path.join(tempDir(), 'f.bin'), 1234);
  assert.deepEqual(measure(file), {bytes: 1234, errors: 0, truncated: false});
});

test('measure reports an error for a missing path', () => {
  assert.deepEqual(measure(path.join(tempDir(), 'nope')), {bytes: 0, errors: 1, truncated: false});
});

test('dirSize respects the entry cap', () => {
  const dir = tempDir();
  buildTree(dir, Object.fromEntries(Array.from({length: 10}, (_, i) => [`file${i}.bin`, 100])));
  const result = dirSize(dir, {maxEntries: 3});
  assert.equal(result.truncated, true);
  assert.ok(result.bytes > 0 && result.bytes < 1000);
});

test('dirSize does not follow symlinks', () => {
  const dir = tempDir();
  makeFile(path.join(dir, 'real', 'big.bin'), 5000);
  fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'loop'));
  assert.equal(dirSize(dir).bytes, 5000);
});

test.skipIf(isRoot)('dirSize tolerates permission errors', () => {
  const dir = tempDir();
  makeFile(path.join(dir, 'ok.bin'), 300);
  makeFile(path.join(dir, 'blocked', 'secret.bin'), 5000);
  block(path.join(dir, 'blocked'));
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

test('glob expands wildcards and skips hidden names', () => {
  const dir = tempDir();
  buildTree(dir, {'avd/a.avd': null, 'avd/b.avd': null, 'avd/c.ini': 1, 'Caches/Foo': null, 'Caches/.hidden': null});
  assert.deepEqual(glob(path.join(dir, 'avd', '*.avd')), [path.join(dir, 'avd', 'a.avd'), path.join(dir, 'avd', 'b.avd')]);
  assert.deepEqual(glob(path.join(dir, 'Caches', '*')), [path.join(dir, 'Caches', 'Foo')]);
  assert.deepEqual(glob(path.join(dir, 'missing', '*')), []);
});

test('iterMatches finds and does not descend into matches', () => {
  const dir = tempDir();
  buildTree(dir, {'projects/a/node_modules/pkg/one.js': 10, 'projects/a/node_modules/pkg/node_modules/x': 10, 'projects/b/node_modules/x/y.js': 10});
  assert.deepEqual(walk([dir], ['**/node_modules']), [path.join(dir, 'projects/a/node_modules'), path.join(dir, 'projects/b/node_modules')]);
});

test('iterMatches skips hidden and heavy dirs', () => {
  const dir = tempDir();
  buildTree(dir, {'.hidden/node_modules/h': 10, '.git/node_modules/g': 10, 'Library/node_modules/lib': 10, 'visible/node_modules/v': 10});
  assert.deepEqual(walk([dir], ['**/node_modules']), [path.join(dir, 'visible/node_modules')]);
});

test('iterMatches respects maxDepth', () => {
  const dir = tempDir();
  buildTree(dir, {'lvl1/lvl2/lvl3/node_modules/deep': 10, 'lvl1/lvl2/node_modules/mid': 10});
  assert.deepEqual(walk([dir], ['**/node_modules'], {maxDepth: 2}), []);
  assert.deepEqual(walk([dir], ['**/node_modules'], {maxDepth: 3}), [path.join(dir, 'lvl1/lvl2/node_modules')]);
});

test('iterMatches is symlink-loop safe', () => {
  const dir = tempDir();
  buildTree(dir, {'p/node_modules/only/x': 10});
  fs.symlinkSync(dir, path.join(dir, 'p', 'back-to-root'));
  assert.deepEqual(walk([dir], ['**/node_modules']), [path.join(dir, 'p/node_modules')]);
});

test('iterMatches applies excludes', () => {
  const dir = tempDir();
  buildTree(dir, {'a/node_modules/x': 10, 'b/node_modules/x': 10});
  assert.deepEqual(walk([dir], ['**/node_modules'], {excludes: ['*/a/node_modules']}), [path.join(dir, 'b/node_modules')]);
});

test('iterMatches stops at maxDirs with a warning', () => {
  const dir = tempDir();
  buildTree(dir, {'a/x': null, 'b/x': null, 'c/node_modules': null});
  const warnings: string[] = [];
  walk([dir], ['**/node_modules'], {maxDirs: 2, warnings});
  assert.match(warnings[0]!, /discovery exceeded 2 directories/);
});

test('formatBytes', () => {
  for (const [size, expected] of [[0, '0 B'], [512, '512 B'], [1023, '1023 B'], [1024, '1 KB'], [842 * 1024 ** 2, '842 MB'], [Math.trunc(2.4 * 1024 ** 3), '2.4 GB'], [Math.trunc(31.17 * 1024 ** 3), '31.2 GB']] as const) {
    assert.equal(formatBytes(size), expected);
  }
  assert.throws(() => formatBytes(-1), RangeError);
});

test('formatAgo boundaries', () => {
  const now = new Date('2026-09-24T12:00:00Z');
  const ago = (ms: number) => formatAgo(new Date(now.getTime() - ms), now);
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
