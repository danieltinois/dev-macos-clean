// ASCII art helpers.
import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {BANNER, SPINNER, bar} from './ascii';

test('bar scales to the width and keeps small values visible', () => {
  assert.equal(bar(5, 10, 10), '█████░░░░░');
  assert.equal(bar(10, 10, 10), '██████████');
  assert.equal(bar(0, 10, 10), '░░░░░░░░░░');
  assert.equal(bar(1, 1000, 10), '█░░░░░░░░░');
  assert.equal(bar(50, 10, 4), '████');
  assert.equal(bar(3, 0, 4), '░░░░');
  for (const [value, max] of [[1, 3], [2, 3], [7, 9]]) assert.equal(bar(value!, max!, 24).length, 24);
});

test('banner is a five-line block without leading or trailing blank lines', () => {
  const lines = BANNER.split('\n');
  assert.equal(lines.length, 5);
  assert.ok(lines.every(line => line.trim().length && line.length <= 52));
});

test('spinner frames are single characters', () => {
  assert.ok(SPINNER.length > 1 && SPINNER.every(frame => [...frame].length === 1));
});
