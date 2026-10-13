// The cat card: a little actor around the ASCII cat. It talks (typing the bubble while its
// mouth moves), fidgets on its own (blinks, looks around, flicks an ear, tilts its head,
// yawns), follows the pointer with its eyes, and reacts to the app state.
import {drawCat, type Mood, type Pose} from '../core/cat';
import {reduced} from './motion';

export type MascotState = 'idle' | 'scanning' | 'cleaning' | 'done' | 'error' | 'empty';
type Fidget = 'blink' | 'look' | 'ear' | 'tilt' | 'yawn' | 'swish';

const FACE: Record<MascotState, Mood> = {idle: 'idle', scanning: 'idle', cleaning: 'happy', done: 'happy', error: 'worried', empty: 'sleepy'};
// Broom swing speed (radians of phase per second) while working.
const SWEEP: Partial<Record<MascotState, number>> = {scanning: 5, cleaning: 11};
// Fidgets each state may pick from, and how long each lasts (ms).
const FIDGETS: Record<MascotState, Fidget[]> = {
  idle: ['blink', 'look', 'ear', 'tilt', 'swish', 'blink', 'look', 'yawn'],
  scanning: ['blink', 'ear', 'look'],
  cleaning: ['ear'],
  done: ['blink', 'look', 'ear', 'tilt', 'swish', 'blink'],
  error: ['blink', 'look'],
  empty: ['ear', 'yawn', 'swish'],
};
const DURATION: Record<Fidget, number> = {blink: 160, look: 1300, ear: 260, tilt: 1500, yawn: 1700, swish: 1800};
const PETS = ['prrrr…', 'Mais carinho! prrr…', 'Hmm, aí atrás da orelha…', 'prrr… valeu!'];
const FPS = 20, TYPE_MS = 32, CHATTER_MS = 22000;

export interface MascotOptions {
  // Lines to chat about between tasks.
  tips?: () => string[];
  // How to draw a frame (defaults to the full cat with tail and broom).
  render?: (mood: Mood, pose: Pose) => string;
  // Milliseconds per typed character.
  typeMs?: number;
}

export function createMascot(button: HTMLButtonElement, art: HTMLElement, bubble: HTMLElement, {tips = () => [], render = drawCat, typeMs = TYPE_MS}: MascotOptions = {}) {
  let state: MascotState = 'idle', message = '', frame = 0, last = 0;
  let speech = '', typed = 0, typedAt = 0, spokeAt = 0;
  let fidget: {kind: Fidget; until: number; look: -1 | 1} | null = null, nextFidget = 0;
  let hopUntil = 0, shakeUntil = 0, purrUntil = 0, pointerLook: -1 | 0 | 1 = 0, gaze: -1 | 0 | 1 | null = null;
  const started = performance.now();

  // Type `text` into the bubble; the mouth moves while it types.
  function speak(text: string, now = performance.now()) {
    speech = text;typed = reduced() ? text.length : 0;typedAt = now;spokeAt = now;
    bubble.textContent = reduced() ? text : '';
    bubble.classList.remove('pop');void bubble.offsetWidth;bubble.classList.add('pop');
  }

  function pose(now: number): [Mood, Pose] {
    const t = (now - started) / 1000, purring = now < purrUntil, active = fidget && now < fidget.until ? fidget : null;
    const talking = typed < speech.length;
    // Mouth follows the letter being typed: open on vowels, half on consonants, shut on spaces.
    const ch = speech[typed] ?? ' ';
    const mouth: Pose['mouth'] = active?.kind === 'yawn' ? 3 : talking ? (/[aeiouáéíóúãõâêô]/i.test(ch) ? 2 : /\s|[.,!?…]/.test(ch) ? 0 : 1) : 0;
    let mood: Mood = purring ? 'purr' : FACE[state];
    if (!purring && (active?.kind === 'blink' || active?.kind === 'yawn')) mood = state === 'empty' ? 'sleepy' : 'blink';
    const speed = SWEEP[state];
    const shaking = now < shakeUntil;
    return [mood, {
      t, mouth,
      sweep: speed && !purring ? Math.sin(t * speed) * 0.3 : 0,
      // Pointer wins over idle glances; while sweeping the cat watches its broom.
      look: gaze ?? (pointerLook || (active?.kind === 'look' ? active.look : speed ? 1 : 0)),
      ear: active?.kind === 'ear',
      tilt: shaking ? (Math.floor(now / 110) % 2 ? 1 : -1) : active?.kind === 'tilt' ? active.look : 0,
      hop: now < hopUntil && Math.floor((hopUntil - now) / 180) % 2 === 1,
      swish: active?.kind === 'swish' || state === 'cleaning' ? 1 : state === 'empty' ? 0.05 : 0.25,
    }];
  }

  function step(now: number) {
    // Typewriter.
    if (typed < speech.length && now - typedAt >= typeMs) {
      typed = Math.min(speech.length, typed + Math.floor((now - typedAt) / typeMs));typedAt = now;
      bubble.textContent = speech.slice(0, typed);
    }
    // Fidgets: one at a time, a random one every couple of seconds, never mid-sentence.
    if ((!fidget || now >= fidget.until) && now >= nextFidget && now >= purrUntil && typed >= speech.length) {
      const choices = FIDGETS[state];
      const kind = choices[Math.floor(Math.random() * choices.length)]!;
      fidget = {kind, until: now + DURATION[kind], look: Math.random() < 0.5 ? -1 : 1};
      nextFidget = fidget.until + 1200 + Math.random() * 2600;
    }
    // Chatter: a tip now and then when nothing else is going on.
    if (now - spokeAt > CHATTER_MS && (state === 'done' || state === 'idle')) {
      const list = tips();
      if (list.length) speak(list[Math.floor(Math.random() * list.length)]!, now);
      else spokeAt = now;
    }
    if (now >= purrUntil && speech.startsWith('prr') && typed >= speech.length && now - spokeAt > 2600) speak(message, now);
    const [mood, p] = pose(now);
    art.textContent = render(mood, p);
  }

  function tick(now: number) {
    frame = requestAnimationFrame(tick);
    if (now - last < 1000 / FPS) return;
    last = now;step(now);
  }
  function start() {
    cancelAnimationFrame(frame);
    if (reduced()) {const [mood, p] = pose(started);art.textContent = render(mood, {...p, mouth: 0, sweep: 0});}
    else frame = requestAnimationFrame(tick);
  }

  // Set the state the cat reflects, and what it says about it.
  function set(next: MascotState, text: string) {
    const now = performance.now();
    if (next === 'done' && state !== 'done') hopUntil = now + 720;
    if (next === 'error') shakeUntil = now + 700;
    state = next;message = text;purrUntil = 0;fidget = null;nextFidget = now + 1500;
    speak(text, now);start();
  }
  // A quick comment on something the user did (selection, filters), with a small hop.
  let reactedAt = 0;
  function react(text: string) {
    const now = performance.now();
    if (now - reactedAt < 900) return;
    reactedAt = now;hopUntil = now + 360;speak(text, now);if (reduced()) start();
  }

  // Force where the eyes look (e.g. at what the tutorial is pointing to); null lets them wander.
  function lookAt(direction: -1 | 0 | 1 | null) {gaze = direction;}
  function stop() {cancelAnimationFrame(frame);}
  // Whether a line is still being typed; finish() shows the rest at once.
  const talking = () => typed < speech.length;
  function finish() {typed = speech.length;bubble.textContent = speech;}

  // Petting: purr and say something, then go back to what it was saying.
  button.onclick = () => {
    const now = performance.now();
    purrUntil = now + 1800;hopUntil = now + 360;fidget = null;
    speak(PETS[Math.floor(Math.random() * PETS.length)]!, now);
    if (reduced()) {start();setTimeout(() => {purrUntil = 0;speak(message);start();}, 1800);}
  };
  // Eyes follow the pointer when it is clearly to one side of the cat.
  window.addEventListener('pointermove', event => {
    const box = art.getBoundingClientRect(), dx = event.clientX - (box.left + box.width * 0.4);
    pointerLook = Math.abs(dx) < box.width * 0.35 ? 0 : dx < 0 ? -1 : 1;
  });
  document.addEventListener('pointerleave', () => {pointerLook = 0;});
  return {set, react, lookAt, stop, talking, finish};
}
