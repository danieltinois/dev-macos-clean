// The mascot: a shaded ASCII cat holding a broom, drawn procedurally so it can
// breathe, swish its tail and sweep. Pure strings, no I/O; used by the CLI and
// the desktop renderer.
//
// Each cell is sampled from simple shapes (ellipsoids lit from the top left,
// triangles for the ears) and mapped to a density ramp. Face, whiskers, collar
// and broom are drawn on top. Every frame is CAT_WIDTH x CAT_HEIGHT.

export type Mood = 'idle' | 'blink' | 'happy' | 'worried' | 'sleepy' | 'purr';
export interface Pose {
  // Seconds of animation time: drives breathing and the tail.
  t?: number;
  // Broom angle in radians (0 = resting, about ±0.3 while sweeping).
  sweep?: number;
}

export const CAT_WIDTH = 46, CAT_HEIGHT = 22;
const RAMP = ' .:-=+*#%@';
type Point = [number, number];

const LIGHT = (() => {const v = [-0.55, -0.65, 0.55], n = Math.hypot(...v);return v.map(c => c / n) as [number, number, number];})();

// Stable per-cell grain so the fur doesn't flicker between frames.
function grain(x: number, y: number) {const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;return s - Math.floor(s);}

// Brightness of an ellipsoid at (X, Y), or null outside it. Ambient light keeps the dark side visible.
function blob(X: number, Y: number, cx: number, cy: number, rx: number, ry: number): number | null {
  const dx = (X - cx) / rx, dy = (Y - cy) / ry, d = dx * dx + dy * dy;
  if (d > 1) return null;
  const z = Math.sqrt(1 - d), len = Math.hypot(dx, dy, z);
  const diffuse = Math.max(0, (dx * LIGHT[0] + dy * LIGHT[1] + z * LIGHT[2]) / len);
  return 0.32 + 0.68 * diffuse - (1 - z) * 0.12;
}

function inTriangle(p: Point, a: Point, b: Point, c: Point) {
  const side = (p1: Point, p2: Point, p3: Point) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = side(p, a, b), d2 = side(p, b, c), d3 = side(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

const shade = (v: number) => RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.round(v * (RAMP.length - 1))))]!;

// Eye patches (two rows). '·' keeps the fur underneath; anything else, spaces included, is drawn.
const EYES: Record<Mood, [string, string]> = {
  idle:    ['·.--.···.--.·', '·|(@)|··|(@)|'],
  blink:   ['·············', '·`--´···`--´·'],
  happy:   ['··/\\·····/\\··', '·/  \\···/  \\·'],
  worried: ['·\\  ····· /·', '·(O)·····(o)·'],
  sleepy:  ['·············', '·-==-···-==-·'],
  purr:    ['··/\\·····/\\··', '·/^^\\···/^^\\·'],
};
const MOUTH: Record<Mood, string> = {idle: ' w ', blink: ' w ', happy: ' \\_/ ', worried: ' ~~~ ', sleepy: ' w ', purr: ' w w '};
const EXTRAS: Record<Mood, [number, number, string][]> = {
  idle: [], blink: [],
  happy: [[3, 1, '*'], [31, 0, '+'], [1, 4, '.'], [33, 3, '*']],
  worried: [[30, 2, '?'], [7, 3, '\''], [6, 4, ',']],
  sleepy: [[29, 0, 'z'], [31, 1, 'Z'], [34, 0, 'z']],
  purr: [[29, 1, '<3'], [33, 0, '<3'], [3, 2, '~']],
};

export function drawCat(mood: Mood = 'idle', {t = 0, sweep = 0}: Pose = {}): string {
  const grid = Array.from({length: CAT_HEIGHT}, () => Array<string>(CAT_WIDTH).fill(' '));
  const text = (x: number, y: number, s: string) => [...s].forEach((ch, i) => {
    if (ch !== '·' && y >= 0 && y < CAT_HEIGHT && x + i >= 0 && x + i < CAT_WIDTH) grid[y]![x + i] = ch;
  });
  const breathe = Math.sin(t * 2) * 0.4, swish = Math.sin(t * 3) * 2.5;
  // The broom pivots in the paw; `axis` points from the paw towards the bristles.
  const pivot: Point = [31, 24], axis: Point = [Math.sin(sweep - 0.18), Math.cos(sweep - 0.18)];
  const handle = Math.abs(axis[0]) < 0.12 ? '|' : axis[0] > 0 ? '\\' : '/';

  for (let y = 0; y < CAT_HEIGHT; y++) for (let x = 0; x < CAT_WIDTH; x++) {
    // Cells are about twice as tall as wide, so world Y is doubled.
    const X = x + 0.5, Y = (y + 0.5) * 2;
    let b: number | null = null;
    const take = (v: number | null, lift = 0) => {if (v !== null) b = v + lift;};
    // Tail: a tapering quadratic curve behind the body.
    for (let i = 0; i <= 30; i++) {
      const u = i / 30, p0: Point = [24, 38], p1: Point = [40, 43], p2: Point = [37 + swish, 22];
      const cx = (1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * p1[0] + u * u * p2[0];
      const cy = (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * p1[1] + u * u * p2[1];
      const r = 2.4 - u * 0.9;
      take(blob(X, Y, cx, cy, r, r * 1.2), -0.05);
    }
    take(blob(X, Y, 18, 30, 11, 12 + breathe)); // body
    take(blob(X, Y, 24, 33, 6.5, 7.5));         // haunch
    take(blob(X, Y, 18, 26, 5, 7), 0.12);       // lighter chest
    take(blob(X, Y, 13.5, 41, 3.4, 2));         // front paws
    take(blob(X, Y, 21.5, 41, 3.4, 2));
    if (inTriangle([X, Y], [8.5, 10], [10, -1], [16.5, 5])) b = 0.75;   // ears
    if (inTriangle([X, Y], [19.5, 5], [26, -1], [27.5, 10])) b = 0.55;
    if (inTriangle([X, Y], [10.5, 7.5], [11, 2], [14.5, 5.5])) b = 0.2; // inner ears
    if (inTriangle([X, Y], [21.5, 5.5], [25, 2], [25.5, 7.5])) b = 0.2;
    take(blob(X, Y, 18, 13.5, 10.5, 9));        // head
    take(blob(X, Y, 18, 18, 4.8, 3.4), 0.1);    // muzzle
    if (b !== null) grid[y]![x] = shade(b + (grain(x, y) - 0.5) * 0.08);

    // Broom, in front of the body: handle, binding, then fanned bristles.
    const dx = X - pivot[0], dy = Y - pivot[1];
    const u = dx * axis[0] + dy * axis[1], w = dx * axis[1] - dy * axis[0];
    if (u > -22 && u < 11 && Math.abs(w) < 0.55) grid[y]![x] = handle;
    if (u >= 11 && u < 12.6 && Math.abs(w) < 1.8) grid[y]![x] = '=';
    const spread = 1.6 + (u - 12.6) * 0.55;
    if (u >= 12.6 && u < 19 && Math.abs(w) < spread) {
      const fan = w / spread;
      grid[y]![x] = u > 17.6 ? (grain(x, y) > 0.5 ? '\'' : '`') : fan < -0.33 ? '/' : fan > 0.33 ? '\\' : grain(x, y) > 0.6 ? 'I' : '|';
    }
    // Arm and paw wrapped around the handle.
    const arm = blob(X, Y, 27.5, 25.5, 4.8, 2.6) ?? blob(X, Y, 31, 24, 2.2, 2.4);
    if (arm !== null) grid[y]![x] = shade(Math.min(0.95, arm + 0.05));
  }

  const [eyesTop, eyesBottom] = EYES[mood];
  text(11, 5, eyesTop);text(11, 6, eyesBottom);
  text(16, 8, ' v ');
  const mouth = MOUTH[mood];
  text(18 - Math.ceil(mouth.length / 2), 9, mouth);
  text(3, 8, '--===');text(28, 8, '===--');   // whiskers
  text(4, 9, '__--');text(29, 9, '--__');
  text(12, 10, '==========');text(16, 11, '(o)'); // collar and bell
  for (const [x, y, s] of EXTRAS[mood]) text(x, y, s);
  if (sweep !== 0) {const drift = Math.round(sweep * 18);text(30 + drift, 21, '.  ` .');text(28 - drift, 20, ' ,');} // dust
  return grid.map(row => row.join('')).join('\n');
}

// `frame` with a speech bubble saying `text` on its right, centered on row `row`.
export function say(frame: string, text: string, row = 9): string {
  const rule = '─'.repeat(text.length + 2), lines = frame.split('\n');
  const bubble: Record<number, string> = {[row - 1]: ` ╭${rule}╮`, [row]: `<│ ${text} │`, [row + 1]: ` ╰${rule}╯`};
  // Hug the drawing, not the frame's blank right margin.
  const edge = Math.max(...lines.map(line => line.trimEnd().length));
  return lines.map((line, i) => (bubble[i] ? `${line.slice(0, edge).padEnd(edge)} ${bubble[i]}` : line).trimEnd()).join('\n');
}
