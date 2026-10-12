// The mascot: a white cat converted to ASCII from a real photo (core/cat-art.ts),
// brought to life with a pose: eyes that look around, a mouth that talks and
// yawns, a twitching ear, a head tilt, a hop, a swishing tail and a broom that
// sweeps. Pure strings, no I/O; used by the CLI and the desktop renderer.
// Every frame is CAT_WIDTH x CAT_HEIGHT whatever the pose.
import {CAT_ART} from './cat-art';

export type Mood = 'idle' | 'blink' | 'happy' | 'worried' | 'sleepy' | 'purr';
export interface Pose {
  // Seconds of animation time: drives the tail and twinkling extras.
  t?: number;
  // Broom angle in radians (0 = resting, about ±0.3 while sweeping).
  sweep?: number;
  // Where the eyes look: -1 left, 0 ahead, 1 right.
  look?: -1 | 0 | 1;
  // 0 closed, 1 half open, 2 open (talking), 3 yawning.
  mouth?: 0 | 1 | 2 | 3;
  // Right ear flicked outwards.
  ear?: boolean;
  // Head tilted by one column: -1 left, 1 right.
  tilt?: -1 | 0 | 1;
  // Lifted one row (a hop).
  hop?: boolean;
  // Tail swish strength, 0 (lazy) to 1 (lashing).
  swish?: number;
}

// The art sits at (ART_X, ART_Y) on the canvas: room on the left for the tail,
// one row on top for hops and one at the bottom for dust.
const ART_X = 6, ART_Y = 1, ART_WIDTH = 40;
export const CAT_WIDTH = ART_X + ART_WIDTH + 14, CAT_HEIGHT = ART_Y + CAT_ART.length + 1;
// Cells are about 1.65x taller than wide in the UI font.
const ASPECT = 1.65;
// Feature positions in CAT_ART coordinates (row, column).
export const EYES = {row: 13, left: 8, right: 19, width: 6};
export const MOUTH = {row: 20, col: 13};
const HEAD_ROWS = 25;
// Rows of the head and chest, for compact portraits (the CLI).
export const BUST_ROWS = 24;
const FUR = ' .:-=+*xX#%@';

// Eye patches: [upper row, lower row] for the left eye ('·' keeps the photo); the right eye is mirrored.
const EYE_PATCH: Record<Mood, [string, string] | null> = {
  idle: null,
  blink: ['++=++·', '`---\'·'],
  happy: ['·.^^.·', '+=··=+'],
  worried: ['·(@@)·', '··\'\'··'],
  sleepy: ['++=++·', '-___-·'],
  purr: ['·.^^.·', '+=··=+'],
};
// Mouth patches by openness: rows starting at MOUTH.
const MOUTH_PATCH: Record<1 | 2 | 3, string[]> = {
  1: ['·`..\'·'],
  2: ['·(  )·', '·`--\'·'],
  3: ['(    )', '(    )', '`----\''],
};
// [column, row, text] extras around the head (canvas coordinates); frames alternate to twinkle.
const EXTRAS: Record<Mood, [number, number, string][][]> = {
  idle: [[]], blink: [[]],
  happy: [[[42, 2, '*'], [45, 5, '+'], [8, 0, '.']], [[43, 1, '+'], [46, 4, '*'], [7, 1, '*']]],
  worried: [[[43, 2, '?'], [42, 6, '\''], [42, 7, ',']]],
  sleepy: [[[41, 3, 'z'], [43, 2, 'Z'], [46, 1, 'z']], [[41, 3, 'z'], [44, 1, 'Z']]],
  purr: [[[41, 3, '<3'], [45, 1, '<3']], [[42, 2, '<3'], [46, 4, '<3']]],
};
const MIRROR: Record<string, string> = {'`': '\'', '\'': '`', '/': '\\', '\\': '/', '(': ')', ')': '('};
const mirror = (s: string) => [...s].reverse().map(c => MIRROR[c] ?? c).join('');

export function drawCat(mood: Mood = 'idle', pose: Pose = {}): string {
  const {t = 0, sweep = 0, look = 0, mouth = 0, ear = false, tilt = 0, hop = false, swish = 0} = pose;
  // Work on a copy of the art, then stamp it onto the canvas.
  const art = CAT_ART.map(line => [...line.padEnd(ART_WIDTH)]);
  const put = (rows: string[][], x: number, y: number, s: string) => [...s].forEach((ch, i) => {
    if (ch !== '·' && rows[y] && x + i >= 0 && x + i < rows[y]!.length) rows[y]![x + i] = ch;
  });

  // Eyes: shift the dark eye holes to look sideways, then apply the mood's patch.
  for (const col of [EYES.left, EYES.right]) for (const row of [EYES.row, EYES.row + 1]) {
    const original = CAT_ART[row]!.padEnd(ART_WIDTH);
    for (let c = col; c < col + EYES.width; c++) art[row]![c] = original[c - look] ?? ' ';
  }
  const patch = EYE_PATCH[mood];
  if (patch) {
    put(art, EYES.left, EYES.row, patch[0]);put(art, EYES.left, EYES.row + 1, patch[1]);
    put(art, EYES.right, EYES.row, mirror(patch[0]));put(art, EYES.right, EYES.row + 1, mirror(patch[1]));
  }
  if (mouth) MOUTH_PATCH[mouth].forEach((line, i) => put(art, MOUTH.col, MOUTH.row + i, line));
  // Ear twitch: the right ear tip flicks one column outwards.
  if (ear) for (const row of [0, 1]) art[row]!.splice(28, 12, ' ', ...art[row]!.slice(28, 39));
  // Head tilt: the head rows slide sideways over the body.
  if (tilt) for (let row = 0; row < HEAD_ROWS; row++) {
    const line = art[row]!;
    art[row] = tilt > 0 ? [' ', ...line.slice(0, -1)] : [...line.slice(1), ' '];
  }

  const top = ART_Y - (hop ? 1 : 0);
  const canvas = Array.from({length: CAT_HEIGHT}, () => Array<string>(CAT_WIDTH).fill(' '));
  art.forEach((line, y) => line.forEach((ch, x) => {if (ch !== ' ' && canvas[top + y]) canvas[top + y]![ART_X + x] = ch;}));

  // Tail: a tapering curve from behind the left haunch, curling up; drawn only on empty cells.
  const base = top + 40, lash = Math.sin(t * (2 + swish * 6)) * (1.2 + swish * 2.4);
  for (let i = 0; i <= 60; i++) {
    const u = i / 60;
    const x = 11 - u * 9 + Math.sin(u * Math.PI) * -1 + lash * u * u;
    const y = base - u * u * 12 + Math.sin(u * Math.PI) * 1.5;
    const radius = 1.5 - u * 0.8;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const cx = Math.round(x + dx), cy = Math.round(y + dy);
      const d = Math.hypot(cx + 0.5 - x, (cy + 0.5 - y) * ASPECT * 0.75);
      if (d > radius || !canvas[cy] || cx < 0 || cx >= CAT_WIDTH || canvas[cy]![cx] !== ' ') continue;
      // Lit from the top left like the photo: brighter towards the upper-left edge of the stroke.
      const light = 0.55 + 0.35 * (1 - d / radius) - (cx + 0.5 - x) * 0.08 - u * 0.1;
      canvas[cy]![cx] = FUR[Math.max(2, Math.min(FUR.length - 1, Math.round(light * (FUR.length - 1))))]!;
    }
  }

  const extras = EXTRAS[mood];
  for (const [x, y, s] of extras[Math.floor(t * 2) % extras.length]!) put(canvas, x, y + top - ART_Y, s);

  // Broom leaning against the cat's side, hanging from its top: handle, binding, fanned bristles.
  const pivot = [53.5, 3 * ASPECT], angle = sweep - 0.1, axis = [Math.sin(angle), Math.cos(angle)];
  const handle = Math.abs(axis[0]!) < 0.08 ? '|' : axis[0]! > 0 ? '\\' : '/';
  const length = 30 * ASPECT;
  for (let y = 0; y < CAT_HEIGHT; y++) for (let x = ART_X + ART_WIDTH - 2; x < CAT_WIDTH; x++) {
    const dx = x + 0.5 - pivot[0]!, dy = (y + 0.5) * ASPECT - pivot[1]!;
    const u = dx * axis[0]! + dy * axis[1]!, w = dx * axis[1]! - dy * axis[0]!;
    if (u > 0 && u < length && Math.abs(w) < 0.55) canvas[y]![x] = handle;
    if (u >= length && u < length + 1.8 && Math.abs(w) < 2) canvas[y]![x] = '#';
    const spread = 2 + (u - length - 1.8) * 0.5;
    if (u >= length + 1.8 && u < length + 12 && Math.abs(w) < spread) {
      const fan = w / spread, tip = u > length + 10.4;
      canvas[y]![x] = tip ? ((x + y) % 2 ? '\'' : '`') : fan < -0.35 ? '/' : fan > 0.35 ? '\\' : (x * 7 + y) % 3 ? '|' : 'I';
    }
  }
  if (sweep !== 0) put(canvas, 48 + Math.round(sweep * 12), CAT_HEIGHT - 1, '. ` .  ,');
  return canvas.map(row => row.join('')).join('\n');
}

// Head-and-chest portrait without the broom or tail, for compact output (the CLI).
export function portrait(mood: Mood = 'idle'): string {
  return drawCat(mood).split('\n').slice(ART_Y, ART_Y + BUST_ROWS).map(line => line.slice(ART_X, ART_X + ART_WIDTH).trimEnd()).join('\n');
}

// `frame` with a speech bubble saying `text` on its right, centered on row `row`.
export function say(frame: string, text: string, row = EYES.row): string {
  const rule = '─'.repeat(text.length + 2), lines = frame.split('\n');
  const bubble: Record<number, string> = {[row - 1]: ` ╭${rule}╮`, [row]: `<│ ${text} │`, [row + 1]: ` ╰${rule}╯`};
  // Hug the drawing, not the frame's blank right margin.
  const edge = Math.max(...lines.map(line => line.trimEnd().length));
  return lines.map((line, i) => (bubble[i] ? `${line.slice(0, edge).padEnd(edge)} ${bubble[i]}` : line).trimEnd()).join('\n');
}
