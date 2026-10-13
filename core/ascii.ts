// ASCII art shared by the CLI and the app UI. Pure strings, no I/O.

// "DEVCLEAN" in the figlet Standard font.
export const BANNER = String.raw`
 ____  _______     ______ _     _____    _    _   _
|  _ \| ____\ \   / / ___| |   | ____|  / \  | \ | |
| | | |  _|  \ \ / / |   | |   |  _|   / _ \ |  \| |
| |_| | |___  \ V /| |___| |___| |___ / ___ \| |\  |
|____/|_____|  \_/  \____|_____|_____/_/   \_\_| \_|`.slice(1);

// Braille spinner frames for "scanning" states.
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const FULL = '█', EMPTY = '░';

// A fixed-width bar like `██████░░░░` for `value` out of `max`. Any non-zero
// value gets at least one block so small items stay visible.
export function bar(value: number, max: number, width = 24): string {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const filled = ratio > 0 ? Math.max(1, Math.round(ratio * width)) : 0;
  return FULL.repeat(filled) + EMPTY.repeat(width - filled);
}

