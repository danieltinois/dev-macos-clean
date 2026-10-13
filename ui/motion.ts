// ASCII-flavored animations for the renderer. Everything snaps to its final
// state when the user asks the OS to reduce motion.
import {bar} from '../core/ascii';

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const running = new WeakMap<Element, number>();

// Run `step(progress)` from 0 to 1 over `ms` on `el`, replacing any animation already running there.
function animate(el: Element, ms: number, step: (t: number) => void, delay = 0) {
  cancelAnimationFrame(running.get(el) ?? 0);
  if (reduced()) return step(1);
  step(0);
  const start = performance.now() + delay;
  const frame = (now: number) => {
    const t = Math.min(Math.max((now - start) / ms, 0), 1);
    step(easeOut(t));
    if (t < 1) running.set(el, requestAnimationFrame(frame));
  };
  running.set(el, requestAnimationFrame(frame));
}

function span(text: string, cls: string) {const el = document.createElement('span');el.textContent = text;el.className = cls;return el;}

// Draw a block bar made of colored segments ([chars, class]) padded with empty blocks.
function draw(el: Element, parts: [number, string][], width: number) {
  const used = parts.reduce((sum, [n]) => sum + n, 0);
  el.replaceChildren(...parts.map(([n, cls]) => span('█'.repeat(n), cls)), span('░'.repeat(Math.max(0, width - used)), 'bar-empty'));
}

const filledOf = (value: number, max: number, width: number) => bar(value, max, width).replaceAll('░', '').length;

// A bar for `value` of `max` that grows block by block.
export function growBar(el: Element, value: number, max: number, width: number, cls = 'bar-fill', delay = 0) {
  const target = filledOf(value, max, width);
  animate(el, 650, t => draw(el, [[Math.round(target * t), cls]], width), delay);
}

// Stacked bar (e.g. safe + review) that grows left to right.
export function growStack(el: Element, values: [number, string][], max: number, width: number) {
  const targets = values.map(([value, cls]) => [filledOf(value, max, width), cls] as [number, string]);
  const total = Math.min(width, targets.reduce((sum, [n]) => sum + n, 0));
  animate(el, 800, t => {
    let left = Math.round(total * t);
    draw(el, targets.map(([n, cls]) => {const take = Math.min(n, left);left -= take;return [take, cls];}), width);
  });
}

// Tween a number shown through `format`, starting from the last value shown in `el`.
export function countUp(el: HTMLElement, to: number, format: (n: number) => string) {
  const from = Number(el.dataset.value ?? 0);
  el.dataset.value = String(to);
  animate(el, 900, t => {el.textContent = format(from + (to - from) * t);});
}

// Reveal multi-line ASCII art column by column, like a terminal printing it.
export function typeIn(el: HTMLElement, art: string) {
  const lines = art.split('\n'), width = Math.max(...lines.map(line => line.length));
  animate(el, 700, t => {
    const cols = Math.round(width * t);
    el.textContent = lines.map(line => line.slice(0, cols) + (cols < width ? '▌' : '')).join('\n');
  }, 120);
}

// Indeterminate "scanning" rows: a ░▒▓█ wave sweeping across each line. Returns a stop function.
export function sweep(el: HTMLElement, rows: number, width: number): () => void {
  const wave = '▒▓██▓▒';
  let frame = 0, timer = 0;
  const paint = () => {
    el.textContent = Array.from({length: rows}, (_, row) => {
      const cells = Array.from({length: width}, () => '░');
      const head = (frame + row * 5) % (width + wave.length) - wave.length;
      [...wave].forEach((char, i) => {if (head + i >= 0 && head + i < width) cells[head + i] = char;});
      return cells.join('');
    }).join('\n');
    frame++;
  };
  paint();
  if (!reduced()) timer = window.setInterval(paint, 45);
  return () => clearInterval(timer);
}

// Fade rows out before they are removed (e.g. after moving them to the Trash).
export function leave(rows: Element[]): Promise<void> {
  if (reduced() || !rows.length) return Promise.resolve();
  rows.forEach(row => row.classList.add('leaving'));
  return new Promise(resolve => setTimeout(resolve, 320));
}
