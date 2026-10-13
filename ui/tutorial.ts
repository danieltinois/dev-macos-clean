// The guided tour: Floco, the cat, walks the user through the app. A spotlight
// highlights one element at a time while a bust of the cat talks next to it.
import {portrait} from '../core/cat';
import {createMascot, type MascotState} from './mascot';
import {reduced} from './motion';
import {PLATFORMS, type Platform} from './platform';

export interface TourContext {
  // Whether a scan already ran. On first launch the tour comes before the first scan.
  scanned: boolean;
}
export interface Step {
  // CSS selectors of the element to highlight, first visible one wins; none means a centered step.
  target?: string | string[];
  text: string | ((context: TourContext) => string);
  mood?: MascotState;
}

export const CAT_NAME = 'Floco';
// The tour for `platform`; the iPhone skips what it doesn't have.
export function stepsFor(platform: Platform): Step[] {
  const {device, lookWhat} = platform;
  return [
    {text: `Oi! Eu sou o ${CAT_NAME}, o gato da faxina. Vou te mostrar o DevClean num minutinho.`},
    {target: '#scan', text: ({scanned}) => scanned
      ? `Aqui eu vasculho o ${device} atrás de ${lookWhat}. Eu já faço isso sozinho quando o app abre.`
      : `Esse botão vasculha o ${device} atrás de ${lookWhat}. Assim que a gente terminar, eu faço a primeira análise.`},
    ...platform.folders ? [{target: '#add-folder', text: 'Quer que eu olhe o app Arquivos também? Escolhe uma pasta aqui, tipo Downloads ou o iCloud Drive inteiro.'}] : [],
    {target: '.stats', text: 'O resumo: quanto eu achei, quanto dá pra limpar sem medo e quanto é melhor você conferir antes.'},
    {target: ['#disk', '.stats'], text: `O espaço do ${device}: o que está em uso, o que eu achei, o que o sistema libera sozinho e quanto está livre.`},
    {target: '.breakdown', text: 'Espaço por ferramenta, do maior pro menor. Clica numa barra que eu filtro a lista pra você.'},
    {target: '.filters', text: 'Também dá pra buscar por nome ou caminho, filtrar por risco e mudar a ordem.'},
    {target: ['#list .row', '#list'], text: 'Cada linha é um achado: ferramenta, caminho, risco e tamanho. Clica pra ver detalhes e como recriar. Cadeado quer dizer que eu não deixo limpar, e eu explico o porquê.'},
    ...platform.automatic ? [
      {target: '.quick', text: '"Selecionar tudo" pega só o que está nos filtros. "Projetos parados" pega dependências de projetos sem mexer há 90+ dias.'},
      {target: '#clean', text: 'Escolheu? Manda pra Lixeira. Eu sempre peço confirmação, e dá pra restaurar pelo Finder.'},
      {target: '#auto', text: 'Com pressa? A limpeza automática leva só caches que se recriam sozinhos e dependências de projetos parados.'},
    ] : [
      {target: '.quick', text: '"Selecionar tudo" pega só o que está nos filtros. Aqui nada é automático: foto é sua, você escolhe.'},
      {target: '#clean', text: 'Escolheu? Manda pra Apagados. O iPhone pede confirmação, e dá pra recuperar no app Fotos por 30 dias.'},
    ],
    {target: '.mascot', text: 'E aqui é o meu cantinho. Quando a gente terminar eu volto pra cá, fico dando dicas e aceito carinho.'},
    {target: '#tour-open', mood: 'done', text: ({scanned}) => scanned
      ? 'Pronto! Se quiser rever, é só clicar em Tutorial. Boa faxina!'
      : 'Pronto! Agora eu começo a análise. Se quiser rever o tour, é só clicar em Tutorial.'},
  ];
}
export const STEPS = stepsFor(PLATFORMS.mac);

export interface Box {left: number; top: number; width: number; height: number}

// Where to put the guide (size `guide`) next to `target` inside `view`: to the right
// if it fits, else left, below, above; centered when there is no target. Always clamped to the view.
export function placeGuide(target: Box | null, guide: {width: number; height: number}, view: {width: number; height: number}, gap = 18): {left: number; top: number; side: 'right' | 'left' | 'below' | 'above' | 'center'} {
  const clamp = (v: number, max: number) => Math.max(12, Math.min(v, max - 12));
  if (!target) return {left: clamp((view.width - guide.width) / 2, view.width - guide.width), top: clamp((view.height - guide.height) / 2, view.height - guide.height), side: 'center'};
  const middleY = target.top + target.height / 2 - guide.height / 2, middleX = target.left + target.width / 2 - guide.width / 2;
  const options = [
    {side: 'right' as const, left: target.left + target.width + gap, top: middleY, fits: target.left + target.width + gap + guide.width <= view.width - 12},
    {side: 'left' as const, left: target.left - gap - guide.width, top: middleY, fits: target.left - gap - guide.width >= 12},
    {side: 'below' as const, left: middleX, top: target.top + target.height + gap, fits: target.top + target.height + gap + guide.height <= view.height - 12},
    {side: 'above' as const, left: middleX, top: target.top - gap - guide.height, fits: target.top - gap - guide.height >= 12},
  ];
  const pick = options.find(option => option.fits) ?? options[2]!;
  return {side: pick.side, left: clamp(pick.left, view.width - guide.width), top: clamp(pick.top, view.height - guide.height)};
}

const SEEN_KEY = 'devclean.tour.seen';
// Whether the tour already ran on this machine. Storage can be unavailable; then it just shows again.
export function tourSeen(): boolean {try {return localStorage.getItem(SEEN_KEY) === '1';} catch {return false;}}
function markSeen() {try {localStorage.setItem(SEEN_KEY, '1');} catch {/* not persisted, fine */}}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const stepText = (step: Step, context: TourContext) => typeof step.text === 'function' ? step.text(context) : step.text;

export function createTutorial({onStart, onEnd, context = () => ({scanned: true}), steps = STEPS}: {onStart?: () => void; onEnd?: () => void; context?: () => TourContext; steps?: Step[]} = {}) {
  const root = $('tour'), spot = $('tour-spot'), guide = $('tour-guide');
  const guideCat = createMascot($<HTMLButtonElement>('tour-cat'), $('tour-cat-art'), $('tour-text'), {render: portrait, typeMs: 20});
  let index = 0, open = false, returnFocus: HTMLElement | null = null;

  function visibleTarget(step: Step) {
    for (const selector of [step.target ?? []].flat()) {
      const el = document.querySelector<HTMLElement>(selector), rect = el?.getBoundingClientRect();
      if (el && rect!.width && rect!.height) return el;
    }
    return null;
  }
  function layout() {
    if (!open) return;
    const el = visibleTarget(steps[index]!);
    const rect = el?.getBoundingClientRect() ?? null, pad = 8;
    if (rect) Object.assign(spot.style, {left: `${rect.left - pad}px`, top: `${rect.top - pad}px`, width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px`, opacity: '1'});
    else Object.assign(spot.style, {left: '50%', top: '50%', width: '0px', height: '0px', opacity: '0'});
    const placed = placeGuide(rect && {left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2},
      {width: guide.offsetWidth, height: guide.offsetHeight}, {width: innerWidth, height: innerHeight});
    Object.assign(guide.style, {left: `${placed.left}px`, top: `${placed.top}px`});
    guide.dataset.side = placed.side;
    // Nothing to point at: dim the whole page instead.
    root.classList.toggle('centered', !rect);
    // Look at what is being shown.
    guideCat.lookAt(placed.side === 'right' ? -1 : placed.side === 'left' ? 1 : 0);
  }
  function show(next: number) {
    index = Math.max(0, Math.min(steps.length - 1, next));
    const step = steps[index]!;
    visibleTarget(step)?.scrollIntoView({block: 'center', behavior: reduced() ? 'auto' : 'smooth'});
    $('tour-progress').textContent = `${index + 1} / ${steps.length}`;
    const text = stepText(step, context());
    $('tour-sr').textContent = text;
    $<HTMLButtonElement>('tour-back').disabled = index === 0;
    $('tour-next').textContent = index === steps.length - 1 ? 'Concluir' : 'Próximo';
    guideCat.set(step.mood ?? 'idle', text);
    // Lay out now and again once smooth scrolling settles.
    requestAnimationFrame(layout);setTimeout(layout, 450);
  }
  function start() {
    if (open) return;
    open = true;returnFocus = document.activeElement as HTMLElement | null;
    root.hidden = false;document.body.classList.add('touring');
    onStart?.();show(0);
    $('tour-next').focus();
  }
  function end() {
    if (!open) return;
    open = false;root.hidden = true;document.body.classList.remove('touring');
    guideCat.stop();markSeen();onEnd?.();
    returnFocus?.focus();
  }
  // Mid-sentence, Next finishes the line first; then it moves on.
  $('tour-next').onclick = () => guideCat.talking() ? guideCat.finish() : index === steps.length - 1 ? end() : show(index + 1);
  $('tour-back').onclick = () => show(index - 1);
  $('tour-skip').onclick = end;
  document.addEventListener('keydown', event => {
    if (!open) return;
    if (event.key === 'Escape') {event.preventDefault();end();}
    else if (event.key === 'ArrowRight') {event.preventDefault();$('tour-next').click();}
    else if (event.key === 'ArrowLeft' && index > 0) {event.preventDefault();show(index - 1);}
  });
  addEventListener('resize', layout);
  addEventListener('scroll', layout, true);
  return {start, end, get open() {return open;}};
}
