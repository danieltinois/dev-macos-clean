import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {STEPS, placeGuide, type Box} from './tutorial';

const html = readFileSync(path.join(import.meta.dirname, 'index.html'), 'utf8');
const renderer = readFileSync(path.join(import.meta.dirname, 'renderer.ts'), 'utf8');

test('every step points at something that exists in the page', () => {
  for (const {target} of STEPS) {
    if (!target) continue;
    for (const token of target.split(/\s+/)) {
      const name = token.slice(1);
      if (token.startsWith('#')) assert.ok(html.includes(`id="${name}"`), `${target}: no #${name} in index.html`);
      // Classes may come from the markup or from rows the renderer builds.
      else assert.ok(new RegExp(`class="[^"]*\\b${name}\\b`).test(html) || renderer.includes(`'${name}'`), `${target}: no .${name}`);
    }
  }
});

test('the tour opens and closes centered, and every line fits the bubble', () => {
  assert.equal(STEPS[0]!.target, undefined);
  assert.equal(STEPS.at(-1)!.mood, 'done');
  for (const step of STEPS) assert.ok(step.text.length > 20 && step.text.length <= 190, step.text);
});

const VIEW = {width: 1280, height: 850}, GUIDE = {width: 560, height: 230};
const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

test('placeGuide keeps the guide on screen and off the highlighted element', () => {
  const targets: Box[] = [
    {left: 40, top: 300, width: 400, height: 500},   // sidebar: guide goes right
    {left: 700, top: 300, width: 540, height: 400},  // results: guide goes left
    {left: 40, top: 40, width: 1200, height: 120},   // wide header strip: guide goes below
    {left: 40, top: 690, width: 1200, height: 140},  // wide footer strip: guide goes above
    {left: 1150, top: 160, width: 90, height: 40},   // a button near the right edge
  ];
  for (const target of targets) {
    const placed = placeGuide(target, GUIDE, VIEW);
    const box = {left: placed.left, top: placed.top, ...GUIDE};
    assert.ok(box.left >= 12 && box.top >= 12 && box.left + box.width <= VIEW.width - 12 && box.top + box.height <= VIEW.height - 12, JSON.stringify(placed));
    assert.ok(!overlaps(box, target), `guide covers ${JSON.stringify(target)} (${placed.side})`);
  }
  assert.deepEqual(placeGuide(targets[0]!, GUIDE, VIEW).side, 'right');
  assert.deepEqual(placeGuide(targets[1]!, GUIDE, VIEW).side, 'left');
  assert.deepEqual(placeGuide(null, GUIDE, VIEW), {left: 360, top: 310, side: 'center'});
});
