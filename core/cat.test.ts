// The ASCII cat mascot.
import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {CAT_ART} from './cat-art';
import {BUST_ROWS, CAT_HEIGHT, CAT_WIDTH, EYES, drawCat, portrait, say, type Mood} from './cat';

const MOODS: Mood[] = ['idle', 'blink', 'happy', 'worried', 'sleepy', 'purr'];

test('every mood and pose has the same size, so animating never shifts the layout', () => {
  const poses = [{}, {t: 0.7, sweep: 0.3, swish: 1}, {sweep: -0.3, look: -1}, {mouth: 3, ear: true}, {tilt: 1, hop: true, mouth: 2}, {tilt: -1, look: 1, mouth: 1}] as const;
  for (const mood of MOODS) for (const pose of poses) {
    const lines = drawCat(mood, pose).split('\n');
    assert.equal(lines.length, CAT_HEIGHT);
    assert.ok(lines.every(line => line.length === CAT_WIDTH), `${mood} ${JSON.stringify(pose)}`);
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

test('pose parts move what they should', () => {
  const idle = drawCat('idle').split('\n');
  const changed = (pose: Parameters<typeof drawCat>[1]) => {
    const lines = drawCat('idle', pose).split('\n');
    return lines.flatMap((line, row) => line === idle[row] ? [] : [row]);
  };
  // Rows are canvas rows: the art starts one row down.
  assert.deepEqual(changed({look: 1}), [EYES.row + 1, EYES.row + 2]);
  assert.ok(changed({mouth: 2}).every(row => row > EYES.row + 2 && row < EYES.row + 12));
  assert.deepEqual(changed({ear: true}), [1, 2]);
  assert.ok(changed({tilt: 1}).every(row => row <= 25));
  assert.equal(changed({hop: true}).length > 30, true);
  assert.notEqual(drawCat('idle', {t: 0, swish: 1}), drawCat('idle', {t: 0.4, swish: 1})); // tail
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
