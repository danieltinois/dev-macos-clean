// ASCII art shared by the CLI and the desktop renderer. Pure strings, no I/O.

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

// The mascot: a cat with a broom. Every mood is a 5-line frame of equal width,
// so swapping frames never shifts the layout.
export type Mood = 'idle' | 'blink' | 'sweepLeft' | 'sweepRight' | 'happy' | 'worried' | 'sleepy' | 'purr';
const CAT_FRAMES: Record<Mood, string> = {
  idle: String.raw`
  /\_/\
 ( o.o )
  > ^ <   |
 /|   |\  |
(_|   |_) #`,
  blink: String.raw`
  /\_/\
 ( -.- )
  > ^ <   |
 /|   |\  |
(_|   |_) #`,
  sweepLeft: String.raw`
  /\_/\
 ( o.o )
  > ^ <    /
 /|   |\  /
(_|   |_)# .`,
  sweepRight: String.raw`
  /\_/\
 ( -.o )
  > ^ <  \
 /|   |\  \
(_|   |_). #`,
  happy: String.raw`
  /\_/\   *
 ( ^.^ )    *
\_> ^ <_/
  |   |
 (_| |_)  --#`,
  worried: String.raw`
  /\_/\    ?
 ( o.O )
  > ~ <   |
 /|   |\  |
(_|   |_) #`,
  sleepy: String.raw`
  /\_/\    z
 ( -.- )  Z
  > ^ <
 /|   |\
(_|   |_) --#`,
  purr: String.raw`
  /\_/\   <3
 ( ^w^ )
  > ^ <   |
 /|   |\  |
(_|   |_) #`,
};
const CAT_WIDTH = Math.max(...Object.values(CAT_FRAMES).flatMap(frame => frame.split('\n').map(line => line.length)));
export const CAT = Object.fromEntries(Object.entries(CAT_FRAMES).map(([mood, frame]) =>
  [mood, frame.slice(1).split('\n').map(line => line.padEnd(CAT_WIDTH)).join('\n')])) as Record<Mood, string>;

// The cat saying `text` in a speech bubble to its right, level with its face.
export function say(frame: string, text: string): string {
  const lines = frame.split('\n'), rule = '─'.repeat(text.length + 2);
  const bubble = [`╭${rule}╮`, `│ ${text} │`, `╰${rule}╯`];
  return lines.map((line, i) => (i === 0 ? line : `${line}  ${[` ${bubble[0]}`, `<${bubble[1]}`, ` ${bubble[2]}`][i - 1] ?? ''}`).trimEnd()).join('\n');
}
