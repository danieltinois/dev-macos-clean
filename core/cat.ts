// The mascot: a white cat converted to ASCII from a real photo (core/cat-art.ts),
// with a broom leaning beside it. Moods swap the eyes and add small extras; the
// broom angle animates sweeping. Pure strings, no I/O; used by the CLI and the
// desktop renderer. Every frame is CAT_WIDTH x CAT_HEIGHT.
import {CAT_ART} from './cat-art';

export type Mood = 'idle' | 'blink' | 'happy' | 'worried' | 'sleepy' | 'purr';
export interface Pose {
  // Broom angle in radians (0 = resting, about ±0.3 while sweeping).
  sweep?: number;
  // Seconds of animation time: twinkles the extras.
  t?: number;
}

const ART_WIDTH = 40;
export const CAT_WIDTH = 54, CAT_HEIGHT = CAT_ART.length + 1;
// Cells are about 1.65x taller than wide in the UI font.
const ASPECT = 1.65;
// Where the eyes sit in CAT_ART (row, first column of each 6-cell eye patch).
export const EYES = {row: 13, left: 8, right: 19};
// Rows of the head and chest, for compact portraits (the CLI).
export const BUST_ROWS = 24;

// Eye patches: [upper row, lower row] for one eye; '·' keeps the photo underneath.
const EYE_PATCH: Record<Mood, [string, string] | null> = {
  idle: null,
  blink: ['++=++·', '`---\'·'],
  happy: ['·.^^.·', '+=··=+'],
  worried: ['·(@@)·', '··\'\'··'],
  sleepy: ['++=++·', '-___-·'],
  purr: ['·.^^.·', '+=··=+'],
};
// [column, row, text] extras around the head; the second list is the twinkle frame.
const EXTRAS: Record<Mood, [number, number, string][][]> = {
  idle: [[]], blink: [[]],
  happy: [[[36, 1, '*'], [39, 4, '+'], [2, 0, '.']], [[37, 0, '+'], [40, 3, '*'], [1, 1, '*']]],
  worried: [[[37, 1, '?'], [36, 5, '\''], [36, 6, ',']]],
  sleepy: [[[35, 2, 'z'], [37, 1, 'Z'], [40, 0, 'z']], [[35, 2, 'z'], [38, 0, 'Z']]],
  purr: [[[35, 2, '<3'], [39, 0, '<3']], [[36, 1, '<3'], [40, 3, '<3']]],
};

export function drawCat(mood: Mood = 'idle', {sweep = 0, t = 0}: Pose = {}): string {
  const grid = Array.from({length: CAT_HEIGHT}, (_, y) => [...(CAT_ART[y] ?? '').padEnd(CAT_WIDTH)]);
  const text = (x: number, y: number, s: string) => [...s].forEach((ch, i) => {
    if (ch !== '·' && y >= 0 && y < CAT_HEIGHT && x + i >= 0 && x + i < CAT_WIDTH) grid[y]![x + i] = ch;
  });
  const patch = EYE_PATCH[mood];
  if (patch) {
    const mirror = (s: string) => [...s].reverse().join('').replace(/[`'/\\()]/g, c => ({'`': '\'', '\'': '`', '/': '\\', '\\': '/', '(': ')', ')': '('})[c]!);
    text(EYES.left, EYES.row, patch[0]);text(EYES.left, EYES.row + 1, patch[1]);
    text(EYES.right, EYES.row, mirror(patch[0]));text(EYES.right, EYES.row + 1, mirror(patch[1]));
  }
  const extras = EXTRAS[mood];
  for (const [x, y, s] of extras[Math.floor(t * 2) % extras.length]!) text(x, y, s);

  // Broom leaning against the cat's side, hanging from its top: handle, binding, fanned bristles.
  const pivot = [47.5, 2 * ASPECT], angle = sweep - 0.1, axis = [Math.sin(angle), Math.cos(angle)];
  const handle = Math.abs(axis[0]!) < 0.08 ? '|' : axis[0]! > 0 ? '\\' : '/';
  const length = 30 * ASPECT;
  for (let y = 0; y < CAT_HEIGHT; y++) for (let x = ART_WIDTH - 2; x < CAT_WIDTH; x++) {
    const dx = x + 0.5 - pivot[0]!, dy = (y + 0.5) * ASPECT - pivot[1]!;
    const u = dx * axis[0]! + dy * axis[1]!, w = dx * axis[1]! - dy * axis[0]!;
    if (u > 0 && u < length && Math.abs(w) < 0.55) grid[y]![x] = handle;
    if (u >= length && u < length + 1.8 && Math.abs(w) < 2) grid[y]![x] = '#';
    const spread = 2 + (u - length - 1.8) * 0.5;
    if (u >= length + 1.8 && u < length + 12 && Math.abs(w) < spread) {
      const fan = w / spread, tip = u > length + 10.4;
      grid[y]![x] = tip ? ((x + y) % 2 ? '\'' : '`') : fan < -0.35 ? '/' : fan > 0.35 ? '\\' : (x * 7 + y) % 3 ? '|' : 'I';
    }
  }
  if (sweep !== 0) {const drift = Math.round(sweep * 12);text(42 + drift, CAT_HEIGHT - 1, '. ` .  ,');}
  return grid.map(row => row.join('')).join('\n');
}

// Head-and-chest portrait without the broom, for compact output (the CLI).
export function portrait(mood: Mood = 'idle'): string {
  return drawCat(mood).split('\n').slice(0, BUST_ROWS).map(line => line.slice(0, ART_WIDTH).trimEnd()).join('\n');
}

// `frame` with a speech bubble saying `text` on its right, centered on row `row`.
export function say(frame: string, text: string, row = EYES.row): string {
  const rule = '─'.repeat(text.length + 2), lines = frame.split('\n');
  const bubble: Record<number, string> = {[row - 1]: ` ╭${rule}╮`, [row]: `<│ ${text} │`, [row + 1]: ` ╰${rule}╯`};
  // Hug the drawing, not the frame's blank right margin.
  const edge = Math.max(...lines.map(line => line.trimEnd().length));
  return lines.map((line, i) => (bubble[i] ? `${line.slice(0, edge).padEnd(edge)} ${bubble[i]}` : line).trimEnd()).join('\n');
}
