// The ASCII cat mascot.
import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {CAT_ART} from './cat-art';
import {BUST_ROWS, CAT_HEIGHT, CAT_WIDTH, EYES, drawCat, portrait, say, type Mood} from './cat';

const MOODS: Mood[] = ['idle', 'blink', 'happy', 'worried', 'sleepy', 'purr'];

test('every mood and pose has the same size, so animating never shifts the layout', () => {
  for (const mood of MOODS) for (const t of [0, 0.7]) for (const sweep of [-0.3, 0, 0.3]) {
    const lines = drawCat(mood, {t, sweep}).split('\n');
    assert.equal(lines.length, CAT_HEIGHT);
    assert.ok(lines.every(line => line.length === CAT_WIDTH), `${mood} t=${t} sweep=${sweep}`);
  }
});

test('eye patches line up with the dark eyes in the generated art', () => {
  // If scripts/cat-art.ts is re-tuned, EYES must move with it.
  const dark = /[ .'`^,]/;
  for (const col of [EYES.left + 1, EYES.right + 2]) assert.match(CAT_ART[EYES.row]![col]!, dark, `eye at ${EYES.row}:${col}`);
});

test('moods change the face, the broom sweeps, frames are deterministic', () => {
  assert.equal(new Set(MOODS.map(mood => drawCat(mood))).size, MOODS.length);
  assert.notEqual(drawCat('idle', {sweep: -0.3}), drawCat('idle', {sweep: 0.3}));
  assert.equal(drawCat('happy', {t: 1}), drawCat('happy', {t: 1}));
  assert.ok(drawCat('sleepy').includes('Z') && drawCat('purr').includes('<3'));
});

test('portrait is the head and chest without the broom', () => {
  const lines = portrait('idle').split('\n');
  assert.equal(lines.length, BUST_ROWS);
  assert.ok(lines.every(line => !line.includes('####')));
});

test('say puts a speech bubble beside the cat', () => {
  const lines = say(portrait('idle'), 'oi').split('\n');
  assert.ok(lines[EYES.row]!.endsWith('<│ oi │'));
  assert.ok(lines[EYES.row - 1]!.endsWith('╭────╮') && lines[EYES.row + 1]!.endsWith('╰────╯'));
});
