import {BANNER, SPINNER, bar} from '../core/ascii';
import type {CleanupFinding, CleanupReport} from './cleanup';
import type {DevcleanBridge} from './preload';

declare global {interface Window {devclean: DevcleanBridge}}
type Item = CleanupFinding & {index: number};

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
const sum = (items: CleanupFinding[]) => items.reduce((total,f)=>total+f.size_bytes,0);
const risks = {SAFE:'Baixo risco', REVIEW:'Revisar', DANGER:'Alto risco'};
function bytes(n: number) {if (!n) return '0 B'; const units = ['B','KB','MB','GB','TB'];const i = Math.min(4,Math.floor(Math.log(n)/Math.log(1024)));return `${(n/1024**i).toLocaleString('pt-BR',{maximumFractionDigits:i ? 1 : 0})} ${units[i]}`;}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) {const el = document.createElement(tag);if (text !== undefined) el.textContent = text;if (cls) el.className = cls;return el;}
function status(text: string, error=false) {stopSpinner();$('status').textContent=text;$('status').className=error?'error':'';}
// Braille spinner on the scan button and status line; a static frame when motion is reduced.
let spinner: ReturnType<typeof setInterval> | null = null;
function startSpinner(button: string, text: string) {
  stopSpinner();
  let frame = 0;
  const draw = () => {const f = SPINNER[frame++ % SPINNER.length];$('scan').textContent=`${f} ${button}`;$('status').textContent=`${f} ${text}`;$('status').className='';};
  draw();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) spinner = setInterval(draw, 80);
}
function stopSpinner() {if (spinner) clearInterval(spinner);spinner = null;}
// Text bar split into filled/empty spans so each part gets its own color.
function meter(el: HTMLElement, value: number, max: number, width: number) {
  const text = bar(value, max, width), filled = text.indexOf('░') === -1 ? width : text.indexOf('░');
  el.replaceChildren(node('span', text.slice(0, filled), 'bar-fill'), node('span', text.slice(filled), 'bar-empty'));
}
// One block-chart row per tool, largest first, on a shared scale.
function breakdown() {
  if (!report) return;
  const entries = Object.entries(report.totals.by_category).filter(([, size]) => size > 0).sort(([, a], [, b]) => b - a);
  const section = $('breakdown').parentElement!;
  section.hidden = !entries.length;
  const pad = Math.max(0, ...entries.map(([c]) => (names[c] || c).length)) + 2, max = entries[0]?.[1] ?? 0;
  $('breakdown').replaceChildren(...entries.map(([c, size]) => {
    const row = node('div', undefined, 'bar-row'), chart = node('span');
    meter(chart, size, max, 32);
    row.append(node('span', (names[c] || c).padEnd(pad), 'bar-label'), chart, node('span', `  ${bytes(size)}`, 'bar-size'));
    return row;
  }));
}
function render() {
  if (!report) return;
  const query = value('search').toLowerCase();
  const items: Item[] = report.findings.map((f,index)=>({...f,index})).filter(f => (! value('category') || f.category === value('category')) && (! value('severity') || f.severity === value('severity')) && `${f.name} ${f.path}`.toLowerCase().includes(query));
  items.sort((a,b)=> value('sort')==='name' ? a.name.localeCompare(b.name) : value('sort')==='date' ? (Date.parse(b.last_modified ?? '')||0)-(Date.parse(a.last_modified ?? '')||0) : b.size_bytes-a.size_bytes);
  $('visible-count').textContent = `${items.length} / ${report.findings.length}`;
  $('list').replaceChildren();
  if (!items.length) {$('list').append(node('div', report.findings.length ? 'Nenhum resultado corresponde aos filtros.' : 'Nenhum artefato encontrado nesta análise.', 'empty'));return;}
  for (const f of items) {
    const row = node('div', undefined,'row');
    const check = node('input');check.type='checkbox';check.dataset.index=String(f.index);check.checked=selected.has(f.index);check.disabled=busy || !f.cleanup_allowed;
    check.setAttribute('aria-label',`Selecionar ${f.path}`);check.title=f.cleanup_reason || 'Enviar à Lixeira';
    check.onchange=()=>{check.checked ? selected.add(f.index) : selected.delete(f.index);selection();};
    const open = node('button', undefined, 'item-details');open.type='button';open.setAttribute('aria-label',`Detalhes de ${f.name}, ${f.path}`);
    const info = node('div',undefined,'row-info');const age=ageDays(f);info.append(node('strong',f.name),node('small',age===null?f.path:`${ago(age)} · ${f.path}`));
    if (!f.cleanup_allowed && f.cleanup_reason) info.append(node('small',`🔒 ${f.cleanup_reason}`,'blocked'));
    open.append(node('span',names[f.category] || f.category,'tool'), info,node('span',risks[f.severity],`badge ${f.severity.toLowerCase()}`),node('span',`${f.size_complete?'':'≥ '}${bytes(f.size_bytes)}`,'size'),node('span','›'));
    open.onclick = ()=>details(f);row.append(check,open);$('list').append(row);
  }
}
function details(f: Item) {
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
for(const id of ['search','category','severity','sort']) $(id).addEventListener(id==='search'?'input':'change',render);
$('export').onclick=async()=>{try{if(await window.devclean.exportReport()) status('Relatório exportado.');}catch(e){status((e as Error).message,true);}};
$('scan').onclick=async()=>{
  setBusy(true);startSpinner('Analisando…','Analisando arquivos…');
  try {
    report=await window.devclean.scan();selected.clear();summary();$('count').textContent=`${report.totals.findings} artefatos encontrados`;
    $('category').replaceChildren(new Option('Todas as ferramentas',''));
    for (const c of Object.keys(report.totals.by_category).sort()) $('category').append(new Option(names[c]||c,c));
    $('warnings').replaceChildren(...report.warnings.map(w=>node('p',w)));
    $('timestamp').textContent=`Última análise: ${new Date(report.scanned_at).toLocaleString('pt-BR')}`;
    const safe=report.findings.filter(f=>f.cleanup_allowed).reduce((sum,f)=>sum+f.size_bytes,0);
    status(safe ? `Análise concluída · ${bytes(safe)} podem ir para a Lixeira com segurança` : 'Análise concluída');render();selection();
  } catch(e){status((e as Error).message,true);} finally {stopSpinner();setBusy(false);$('scan').textContent='Analisar novamente';}
};

function selectWhere(predicate: (f: CleanupFinding) => boolean) {
  if (!report) return;
  selected.clear();
  // Shortest paths first: a folder already selected covers anything inside it.
  const picked: string[]=[];
  report.findings.map((f,i)=>({f,i})).filter(({f})=>f.cleanup_allowed && predicate(f)).sort((a,b)=>a.f.path.length-b.f.path.length).forEach(({f,i})=>{
    if (picked.some(p=>f.path.startsWith(p+'/'))) return;
    picked.push(f.path);selected.add(i);
  });
  render();selection();
}
$('select-safe').onclick=()=>selectWhere(()=>true);
$('select-stale').onclick=()=>selectWhere(isStale);
$('select-none').onclick=()=>selectWhere(()=>false);
function summary() {
  if (!report) return;
  const total=report.totals.bytes, safe=sum(report.findings.filter(f=>f.cleanup_allowed)), review=(report.totals.by_severity.REVIEW||0)+(report.totals.by_severity.DANGER||0);
  $('total').textContent=bytes(total);$('safe').textContent=bytes(safe);$('review').textContent=bytes(review);
  meter($('total-bar'),total,total,20);meter($('safe-bar'),safe,total,20);meter($('review-bar'),review,total,20);
  breakdown();
  const stale=report.findings.filter(isStale);
  $('select-stale').textContent=`Projetos parados (90+ dias)${stale.length?` · ${bytes(sum(stale))}`:''}`;
  const auto=report.findings.filter(f=>f.auto_clean);
  $('auto').textContent=auto.length?`Limpeza automática · ${bytes(sum(auto))}`:'Limpeza automática';
}
function selection() {
  const total = [...selected].reduce((sum,i)=>sum+(report?.findings[i]?.size_bytes||0),0);
  const review = [...selected].filter(i=>report?.findings[i]?.cleanup_review).length;
  $('selection').textContent = selected.size ? `${selected.size} selecionado(s) · ${bytes(total)}${review?` · ${review} para revisar`:''}` : 'Selecione itens para limpar';
  button('clean').disabled = busy || !selected.size;
  const any = Boolean(report?.findings.some(f=>f.cleanup_allowed));
  button('select-safe').disabled = busy || !any;
  button('select-stale').disabled = busy || !report?.findings.some(isStale);
  button('select-none').disabled = busy || !selected.size;
  button('auto').disabled = busy || !report?.findings.some(f=>f.auto_clean);
}
function setBusy(value: boolean) {
  busy=value;button('scan').disabled=value;button('export').disabled=value||!report;
  for(const input of $('list').querySelectorAll('input')) input.disabled=value || !report?.findings[Number(input.dataset.index)]?.cleanup_allowed;
  selection();
  if(report) render();
}
$('clean').onclick=()=>clean(false);
$('auto').onclick=()=>{selectWhere(f=>f.auto_clean);clean(true);};
async function clean(automatic: boolean) {
  setBusy(true);status('Validando seleção…');
  try {
    const result=await window.devclean.cleanup([...selected],report!.cleanup_token,automatic);
    if(result.canceled) {status('Limpeza cancelada');return;}
    report=result.report;selected.clear();
    summary();$('count').textContent=`${report.totals.findings} artefatos restantes`;
    $('warnings').replaceChildren(...report.warnings.map(w=>node('p',w)),...result.errors.map(e=>node('p',`${e.path}: ${e.message}`)));
    const movedBytes=result.moved.reduce((sum,f)=>sum+f.size_bytes,0);
    status(`${result.moved.length} item(ns) na Lixeira · ${bytes(movedBytes)}. Esvazie a Lixeira para liberar espaço.${result.errors.length?' Alguns itens falharam.':''}`, Boolean(result.errors.length));
  } catch(e){status((e as Error).message,true);} finally {setBusy(false);}
}
$('logo').textContent=BANNER;
// Start the first scan right away: there is nothing to configure.
$('scan').click();
