// paths.ts must match node:path (POSIX), since the cleanup policy compares paths.
import {test} from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as paths from './paths';

const SAMPLES = ['', '.', '..', '/', '//', 'a', 'a/', '/a', '/a/', '/a//b', '/a/./b', '/a/../b', '/../a', 'a/../..', '../a/b', '/a/b/..', '/a/b/../', 'a/./b/', '/Users/me/Library/Caches/*', '/a/b.avd'];

test('normalize, basename and dirname match node:path', () => {
  for (const sample of SAMPLES) {
    assert.equal(paths.normalize(sample), path.normalize(sample), `normalize ${JSON.stringify(sample)}`);
    assert.equal(paths.basename(sample), path.basename(sample), `basename ${JSON.stringify(sample)}`);
    assert.equal(paths.dirname(sample), path.dirname(sample), `dirname ${JSON.stringify(sample)}`);
  }
});

test('join and resolve match node:path', () => {
  for (const a of SAMPLES) for (const b of ['b', '/b', '../b', 'b/', '']) {
    assert.equal(paths.join(a, b), path.join(a, b), `join ${JSON.stringify([a, b])}`);
    assert.equal(paths.resolve('/cwd/x', a, b), path.resolve('/cwd/x', a, b), `resolve ${JSON.stringify([a, b])}`);
  }
});
