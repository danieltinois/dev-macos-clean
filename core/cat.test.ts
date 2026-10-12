// The procedural cat mascot.
import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {CAT_HEIGHT, CAT_WIDTH, drawCat, say, type Mood} from './cat';

const MOODS: Mood[] = ['idle', 'blink', 'happy', 'worried', 'sleepy', 'purr'];

test('every mood, pose and moment has the same size, so animating never shifts the layout', () => {
  for (const mood of MOODS) for (const t of [0, 0.7, 2.3]) for (const sweep of [-0.3, 0, 0.3]) {
    const lines = drawCat(mood, {t, sweep}).split('\n');
    assert.equal(lines.length, CAT_HEIGHT);
    assert.ok(lines.every(line => line.length === CAT_WIDTH), `${mood} t=${t} sweep=${sweep}`);
  }
});

test('frames are deterministic and the pose actually moves things', () => {
  assert.equal(drawCat('idle', {t: 1}), drawCat('idle', {t: 1}));
  assert.notEqual(drawCat('idle', {t: 0}), drawCat('idle', {t: 0.5}));          // tail and breathing
  assert.notEqual(drawCat('idle', {sweep: -0.3}), drawCat('idle', {sweep: 0.3})); // broom
});

test('moods change the face and extras', () => {
  const frames = MOODS.map(mood => drawCat(mood));
  assert.equal(new Set(frames).size, MOODS.length);
  assert.ok(drawCat('idle').includes('|(@)|'));
  assert.ok(drawCat('sleepy').includes('Z'));
  assert.ok(drawCat('purr').includes('<3'));
  assert.ok(drawCat('idle').includes('(o)')); // collar bell
});

test('say puts a speech bubble beside the cat', () => {
  const lines = say(drawCat('idle'), 'oi').split('\n');
  assert.equal(lines.length, CAT_HEIGHT);
  assert.ok(lines[9]!.endsWith('<│ oi │'));
  assert.ok(lines[8]!.endsWith('╭────╮') && lines[10]!.endsWith('╰────╯'));
});
