// ASCII art helpers.
import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {BANNER, CAT, SPINNER, bar, say} from './ascii';

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

test('cat frames share one size so swapping them never shifts the layout', () => {
  const sizes = Object.values(CAT).map(frame => {const lines = frame.split('\n');return `${lines.length}x${new Set(lines.map(line => line.length)).size === 1 ? lines[0]!.length : 'ragged'}`;});
  assert.equal(new Set(sizes).size, 1, sizes.join(' '));
  assert.ok(sizes[0]!.startsWith('5x'));
});

test('say puts a speech bubble beside the cat', () => {
  const lines = say(CAT.idle, 'oi').split('\n');
  assert.equal(lines.length, 5);
  assert.ok(lines[2]!.endsWith('<│ oi │'));
  assert.ok(lines[1]!.endsWith('╭────╮') && lines[3]!.endsWith('╰────╯'));
});
