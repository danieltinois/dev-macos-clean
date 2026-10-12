// The broom-wielding cat in the header: animates the procedural cat for the app state and talks in a bubble.
import {drawCat, type Mood} from '../core/cat';
import {reduced} from './motion';

export type MascotState = 'idle' | 'scanning' | 'cleaning' | 'done' | 'error' | 'empty';
const FACE: Record<MascotState, Mood> = {idle: 'idle', scanning: 'idle', cleaning: 'happy', done: 'happy', error: 'worried', empty: 'sleepy'};
// Broom swing speed (radians of phase per second) while working.
const SWEEP: Partial<Record<MascotState, number>> = {scanning: 5, cleaning: 11};
const FPS = 15;

export function createMascot(button: HTMLButtonElement, art: HTMLElement, bubble: HTMLElement) {
  let state: MascotState = 'idle', message = '', purrUntil = 0, frame = 0, last = 0;
  const started = performance.now();
  function speak(text: string) {
    bubble.textContent = text;
    // Restart the pop-in animation on every new line.
    bubble.classList.remove('pop');void bubble.offsetWidth;bubble.classList.add('pop');
  }
  function paint(now: number) {
    const t = (now - started) / 1000, purring = now < purrUntil;
    const speed = SWEEP[state];
    // Blink for ~150 ms every 3.6 s while idle.
    const blinking = state === 'idle' && !purring && t % 3.6 < 0.15;
    const mood: Mood = purring ? 'purr' : blinking ? 'blink' : FACE[state];
    art.textContent = drawCat(mood, {t, sweep: speed && !purring ? Math.sin(t * speed) * 0.3 : 0});
    if (!purring && bubble.textContent === 'prrrr…') speak(message);
  }
  function tick(now: number) {
    frame = requestAnimationFrame(tick);
    if (now - last < 1000 / FPS) return;
    last = now;paint(now);
  }
  function start() {cancelAnimationFrame(frame);if (reduced()) paint(started);else frame = requestAnimationFrame(tick);}
  function set(next: MascotState, text: string) {
    state = next;message = text;purrUntil = 0;
    speak(text);start();
  }
  // Petting: purr for a moment, then go back to whatever it was doing.
  button.onclick = () => {
    purrUntil = performance.now() + 1600;speak('prrrr…');
    if (reduced()) {paint(performance.now());setTimeout(() => {paint(performance.now());speak(message);}, 1600);}
  };
  return {set};
}
