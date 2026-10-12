// The broom-wielding cat in the header: picks frames for the app state and talks in a bubble.
import {CAT, type Mood} from '../core/ascii';
import {reduced} from './motion';

export type MascotState = 'idle' | 'scanning' | 'cleaning' | 'done' | 'error' | 'empty';
const STILL: Record<MascotState, Mood> = {idle: 'idle', scanning: 'sweepLeft', cleaning: 'sweepLeft', done: 'happy', error: 'worried', empty: 'sleepy'};

export function createMascot(button: HTMLButtonElement, art: HTMLElement, bubble: HTMLElement) {
  let state: MascotState = 'idle', message = '', loop = 0, purring = 0;
  const show = (mood: Mood) => {art.textContent = CAT[mood];};
  function speak(text: string) {
    bubble.textContent = text;
    // Restart the pop-in animation on every new line.
    bubble.classList.remove('pop');void bubble.offsetWidth;bubble.classList.add('pop');
  }
  function animate() {
    clearInterval(loop);
    show(STILL[state]);
    if (reduced()) return;
    if (state === 'scanning' || state === 'cleaning') {
      let left = true;
      loop = window.setInterval(() => show((left = !left) ? 'sweepLeft' : 'sweepRight'), state === 'cleaning' ? 130 : 260);
    } else if (state === 'idle') {
      // Blink for a moment every few seconds.
      loop = window.setInterval(() => {show('blink');setTimeout(() => {if (state === 'idle' && !purring) show('idle');}, 160);}, 3600);
    }
  }
  function set(next: MascotState, text: string) {
    state = next;message = text;
    clearTimeout(purring);purring = 0;
    animate();speak(text);
  }
  // Petting: purr for a moment, then go back to whatever it was doing.
  button.onclick = () => {
    clearInterval(loop);clearTimeout(purring);
    show('purr');speak('prrrr…');
    purring = window.setTimeout(() => {purring = 0;animate();speak(message);}, 1600);
  };
  return {set};
}
