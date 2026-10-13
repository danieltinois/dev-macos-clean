import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {diskParts} from './disk';

const GB = 1024 ** 3;

test('the volume splits into other, found, purgeable and free', () => {
  assert.deepEqual(diskParts({total_bytes: 500 * GB, free_bytes: 100 * GB, purgeable_bytes: 50 * GB}, 30 * GB),
    {total: 500 * GB, other: 320 * GB, found: 30 * GB, purgeable: 50 * GB, free: 100 * GB, freeAfter: 130 * GB});
});

test('without purgeable space everything not free is in use', () => {
  const parts = diskParts({total_bytes: 100, free_bytes: 40, purgeable_bytes: null}, 10);
  assert.deepEqual([parts.other, parts.found, parts.purgeable, parts.freeAfter], [50, 10, null, 50]);
});

test('findings never count for more than the space in use', () => {
  const parts = diskParts({total_bytes: 100, free_bytes: 90, purgeable_bytes: 0}, 500);
  assert.deepEqual([parts.other, parts.found, parts.freeAfter], [0, 10, 100]);
});
