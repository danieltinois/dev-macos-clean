import {BANNER, SPINNER} from '../core/ascii';
import {createMascot} from './mascot';
import {countUp, growBar, growStack, leave, reduced, sweep, typeIn} from './motion';
import {pick, visible, type Filters, type Indexed} from './selection';
import type {CleanupFinding, CleanupReport} from './cleanup';
import type {DevcleanBridge} from './preload';

declare global {interface Window {devclean: DevcleanBridge}}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => $<HTMLInputElement | HTMLSelectElement>(id).value;
const button = (id: string) => $<HTMLButtonElement>(id);
let report: CleanupReport | null = null, activeIndex: number | null = null, busy = false;
const selected = new Set<number>();
const names: Record<string, string> = {node:'Node.js', xcode:'Xcode', android:'Android', python:'Python', rust:'Rust', go:'Go', java:'Java', flutter:'Flutter', docker:'Docker', ide:'IDEs', macos:'macOS', downloads:'Downloads', logs:'Logs', homebrew:'Homebrew'};
function ageDays(f: CleanupFinding) {const t = Date.parse(f.last_modified ?? '');return Number.isNaN(t) ? null : Math.floor((Date.now()-t)/86400000);}
function ago(days: number | null) {if (days === null) return '';if (days < 1) return 'hoje';if (days < 31) return `há ${days} dia(s)`;if (days < 365) return `há ${Math.floor(days/30)} mês(es)`;return `há ${(days/365).toLocaleString('pt-BR',{maximumFractionDigits:1})} ano(s)`;}
// auto_clean comes from the main process, which owns the cleanup policy.
const isStale = (f: CleanupFinding) => f.auto_clean && Boolean(f.metadata?.project);
// "Safe" is what may go to the Trash without review; everything else needs a look.
const isSafe = (f: CleanupFinding) => f.cleanup_allowed && !f.cleanup_review;
const sum = (items: CleanupFinding[]) => items.reduce((total,f)=>total+f.size_bytes,0);
const risks = {SAFE:'Baixo risco', REVIEW:'Revisar', DANGER:'Alto risco'};
function bytes(n: number) {if (n < 1) return '0 B'; const units = ['B','KB','MB','GB','TB'];const i = Math.min(4,Math.floor(Math.log(n)/Math.log(1024)));return `${(n/1024**i).toLocaleString('pt-BR',{maximumFractionDigits:i ? 1 : 0})} ${units[i]}`;}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) {const el = document.createElement(tag);if (text !== undefined) el.textContent = text;if (cls) el.className = cls;return el;}
function status(text: string, error=false) {stopSpinner();$('status').textContent=text;$('status').className=error?'error':'';}
const filters = (): Filters => ({query: value('search'), category: value('category'), severity: value('severity')});
const filtered = () => Boolean(value('search') || value('category') || value('severity'));
const shown = () => report ? visible(report.findings, filters()) : [];
const cat = createMascot(button('cat'), $('cat-art'), $('cat-says'));

// Braille spinner on the scan button and status line, plus a ░▒▓█ sweep in the chart.
let spinner: ReturnType<typeof setInterval> | null = null, stopSweep: (() => void) | null = null;
function startSpinner(label: string, text: string) {
  stopSpinner();
  let frame = 0;
  const draw = () => {const f = SPINNER[frame++ % SPINNER.length];$('scan').textContent=`${f} ${label}`;$('status').textContent=`${f} ${text}`;$('status').className='';};
  draw();
  if (!reduced()) spinner = setInterval(draw, 80);
  const scanning = node('pre', undefined, 'sweep');
  $('breakdown').replaceChildren(scanning);$('breakdown-hint').textContent='analisando…';
  stopSweep = sweep(scanning, 6, 30);
}
function stopSpinner() {if (spinner) clearInterval(spinner);spinner = null;stopSweep?.();stopSweep = null;}

// One clickable block-chart row per tool, largest first, on a shared scale. Clicking filters the results.
function breakdown() {
  if (!report) return;
  const entries = Object.entries(report.totals.by_category).filter(([, size]) => size > 0).sort(([, a], [, b]) => b - a);
  const max = entries[0]?.[1] ?? 0, active = value('category');
  $('breakdown-hint').textContent = active ? '× limpar filtro' : 'clique para filtrar';
  if (!entries.length) {$('breakdown').replaceChildren(node('p', 'Nada encontrado.', 'muted'));return;}
  $('breakdown').replaceChildren(...entries.map(([c, size], i) => {
    const row = node('button', undefined, `bar-row${c === active ? ' active' : ''}`), chart = node('span', undefined, 'bar-chart');
    row.type = 'button';row.setAttribute('aria-pressed', String(c === active));row.title = `Mostrar só ${names[c] || c}`;
    row.append(node('span', names[c] || c, 'bar-label'), chart, node('span', bytes(size), 'bar-size'));
    row.onclick = () => {$<HTMLSelectElement>('category').value = c === active ? '' : c;update();};
    growBar(chart, size, max, 20, 'bar-fill', i * 40);
    return row;
  }));
}

function render(animate = false) {
  if (!report) return;
  const items = shown();
  items.sort((a,b)=> value('sort')==='name' ? a.name.localeCompare(b.name) : value('sort')==='date' ? (Date.parse(b.last_modified ?? '')||0)-(Date.parse(a.last_modified ?? '')||0) : b.size_bytes-a.size_bytes);
  $('visible-count').textContent = `${items.length} / ${report.findings.length}`;
  $('list').classList.toggle('animate', animate && !reduced());
  $('list').replaceChildren();
  if (!items.length) {$('list').append(node('div', report.findings.length ? 'Nenhum resultado corresponde aos filtros.' : 'Nenhum artefato encontrado nesta análise.', 'empty'));return;}
  items.forEach((f, i) => {
    const row = node('div', undefined,'row');row.dataset.index=String(f.index);row.style.setProperty('--i', String(Math.min(i, 24)));
    const check = node('input');check.type='checkbox';check.dataset.index=String(f.index);check.checked=selected.has(f.index);check.disabled=busy || !f.cleanup_allowed;
    check.setAttribute('aria-label',`Selecionar ${f.path}`);check.title=f.cleanup_reason || 'Enviar à Lixeira';
    check.onchange=()=>{check.checked ? selected.add(f.index) : selected.delete(f.index);row.classList.toggle('selected', check.checked);selection();};
    row.classList.toggle('selected', check.checked);
    const open = node('button', undefined, 'item-details');open.type='button';open.setAttribute('aria-label',`Detalhes de ${f.name}, ${f.path}`);
    const info = node('div',undefined,'row-info');const age=ageDays(f);info.append(node('strong',f.name),node('small',age===null?f.path:`${ago(age)} · ${f.path}`));
    if (!f.cleanup_allowed && f.cleanup_reason) info.append(node('small',`🔒 ${f.cleanup_reason}`,'blocked'));
    open.append(node('span',names[f.category] || f.category,'tool'), info,node('span',risks[f.severity],`badge ${f.severity.toLowerCase()}`),node('span',`${f.size_complete?'':'≥ '}${bytes(f.size_bytes)}`,'size'),node('span','›','chevron'));
    open.onclick = ()=>details(f);row.append(check,open);$('list').append(row);
  });
}
// Filters changed: re-render the list, the chart highlight and the selection buttons.
function update() {render();breakdown();selection();}

function details(f: Indexed) {
  activeIndex=f.index;$('detail-title').textContent=f.name;
  const body=$('detail-body');body.replaceChildren(node('p',f.description));
  for (const [label,text] of [['Caminho',f.path],['Tamanho e classificação',`${f.size_complete?'':'Medição parcial: pelo menos '}${bytes(f.size_bytes)} · ${risks[f.severity]} · ${f.reclaimable?'Recriável':'Pode conter dados locais'}`],['Última modificação',f.last_modified ? new Date(f.last_modified).toLocaleString('pt-BR') : 'Indisponível'],['Como recriar',f.rebuild?.description || 'Sem instruções de reconstrução.']] as const) body.append(node('h3',label),node('p',text));
  if(f.rebuild?.commands?.length) body.append(node('pre',f.rebuild.commands.join('\n')));
  body.append(node('h3','Limpeza'),node('p',!f.cleanup_allowed ? f.cleanup_reason : f.auto_clean ? 'Incluído na limpeza automática.' : f.cleanup_review ? 'Pode ir para a Lixeira se você selecionar. Confira antes: pode conter dados que não voltam sozinhos.' : 'Pode ir para a Lixeira se você selecionar.'));
  for (const [key,text] of Object.entries(f.metadata)) body.append(node('h3',key),node('p',text));
  $<HTMLDialogElement>('details').showModal();
}
$('close').onclick=()=>$<HTMLDialogElement>('details').close();
$('reveal').onclick=async()=>{try{await window.devclean.reveal(activeIndex!);}catch(e){status((e as Error).message,true);$<HTMLDialogElement>('details').close();}};
for(const id of ['search','category','severity','sort']) $(id).addEventListener(id==='search'?'input':'change',update);
$('export').onclick=async()=>{try{if(await window.devclean.exportReport()) status('Relatório exportado.');}catch(e){status((e as Error).message,true);}};
$('scan').onclick=async()=>{
  setBusy(true);startSpinner('Analisando…','Analisando arquivos…');cat.set('scanning','Varrendo caches e node_modules…');
  try {
    report=await window.devclean.scan();selected.clear();$('count').textContent=`${report.totals.findings} artefatos encontrados`;
    $('category').replaceChildren(new Option('Todas as ferramentas',''));
    for (const c of Object.keys(report.totals.by_category).sort()) $('category').append(new Option(names[c]||c,c));
    $('warnings').replaceChildren(...report.warnings.map(w=>node('p',w)));
    $('timestamp').textContent=`Última análise: ${new Date(report.scanned_at).toLocaleString('pt-BR')}`;
    stopSpinner();summary();render(true);
    const safe=sum(report.findings.filter(isSafe));
    status(safe ? `Análise concluída · ${bytes(safe)} podem ir para a Lixeira com segurança` : 'Análise concluída');
    if (safe) cat.set('done',`Achei ${bytes(safe)} para limpar sem medo!`);
    else if (report.findings.length) cat.set('done','Tudo conferido. Veja os itens para revisar.');
    else cat.set('empty','Nada para varrer. Seu Mac está em dia!');
  } catch(e){status((e as Error).message,true);breakdown();cat.set('error','Ops! A análise não terminou.');} finally {stopSpinner();setBusy(false);$('scan').textContent='Analisar novamente';}
};

// Quick selections act on what the filters show; automatic cleanup always covers the whole report.
function selectWhere(predicate: (f: CleanupFinding) => boolean, items: Indexed[] = shown()) {
  selected.clear();
  for (const index of pick(items, predicate)) selected.add(index);
  render();selection();
}
$('select-safe').onclick=()=>selectWhere(()=>true);
$('select-stale').onclick=()=>selectWhere(isStale);
$('select-none').onclick=()=>selectWhere(()=>false);
function summary() {
  if (!report) return;
  const total=report.totals.bytes, safe=sum(report.findings.filter(isSafe)), review=total-safe;
  countUp($('total'),total,bytes);countUp($('safe'),safe,bytes);countUp($('review'),review,bytes);
  growStack($('total-bar'),[[safe,'bar-fill'],[review,'bar-amber']],total,20);
  growBar($('safe-bar'),safe,total,20);growBar($('review-bar'),review,total,20,'bar-amber');
  breakdown();
  const auto=report.findings.filter(f=>f.auto_clean);
  $('auto').textContent=auto.length?`Limpeza automática · ${bytes(sum(auto))}`:'Limpeza automática';
}
function selection() {
  const items = shown(), inView = new Set(items.map(f => f.index));
  const total = [...selected].reduce((sum,i)=>sum+(report?.findings[i]?.size_bytes||0),0);
  const review = [...selected].filter(i=>report?.findings[i]?.cleanup_review).length;
  const hidden = [...selected].filter(i=>!inView.has(i)).length;
  $('selection').textContent = selected.size ? `${selected.size} selecionado(s) · ${bytes(total)}${review?` · ${review} para revisar`:''}${hidden?` · ${hidden} fora do filtro`:''}` : 'Selecione itens para limpar';
  button('clean').disabled = busy || !selected.size;
  $('clean').classList.toggle('ready', selected.size > 0);
  const stale = items.filter(f=>f.cleanup_allowed && isStale(f));
  $('select-safe').textContent = filtered() ? 'Selecionar filtrados' : 'Selecionar tudo';
  $('select-stale').textContent=`Projetos parados (90+ dias)${stale.length?` · ${bytes(sum(stale))}`:''}`;
  button('select-safe').disabled = busy || !items.some(f=>f.cleanup_allowed);
  button('select-stale').disabled = busy || !stale.length;
  button('select-none').disabled = busy || !selected.size;
  button('auto').disabled = busy || !report?.findings.some(f=>f.auto_clean);
}
function setBusy(value: boolean) {
  busy=value;button('scan').disabled=value;button('export').disabled=value||!report;
  document.body.classList.toggle('busy', value);
  for(const input of $('list').querySelectorAll('input')) input.disabled=value || !report?.findings[Number(input.dataset.index)]?.cleanup_allowed;
  selection();
}
$('clean').onclick=()=>clean(false);
$('auto').onclick=()=>{if (report) {selectWhere(f=>f.auto_clean, visible(report.findings, {query:'', category:'', severity:''}));clean(true);}};
async function clean(automatic: boolean) {
  setBusy(true);status('Validando seleção…');cat.set('idle','Confere a lista antes de confirmar.');
  try {
    const result=await window.devclean.cleanup([...selected],report!.cleanup_token,automatic);
    if(result.canceled) {status('Limpeza cancelada');cat.set('idle','Tudo bem, nada foi movido.');return;}
    cat.set('cleaning','Pra Lixeira!');
    const moved = new Set(result.moved.map(f=>f.path));
    await leave([...$('list').querySelectorAll<HTMLElement>('.row')].filter(row=>moved.has(report!.findings[Number(row.dataset.index)]?.path ?? '')));
    report=result.report;selected.clear();
    summary();render();$('count').textContent=`${report.totals.findings} artefatos restantes`;
    $('warnings').replaceChildren(...report.warnings.map(w=>node('p',w)),...result.errors.map(e=>node('p',`${e.path}: ${e.message}`)));
    const movedBytes=result.moved.reduce((sum,f)=>sum+f.size_bytes,0);
    status(`${result.moved.length} item(ns) na Lixeira · ${bytes(movedBytes)}. Esvazie a Lixeira para liberar espaço.${result.errors.length?' Alguns itens falharam.':''}`, Boolean(result.errors.length));
    if (result.errors.length) cat.set('error',`${result.errors.length} item(ns) não saíram. Veja os avisos.`);
    else cat.set('done',`Prontinho! ${bytes(movedBytes)} a menos. Agora é só esvaziar a Lixeira.`);
  } catch(e){status((e as Error).message,true);cat.set('error','Ops! Não consegui limpar.');} finally {setBusy(false);}
}
typeIn($('logo'), BANNER);
cat.set('idle','Oi! Já vou dar uma olhada no seu Mac.');
// Start the first scan right away: there is nothing to configure.
$('scan').click();
