const $ = id => document.getElementById(id);
let report = null, activeIndex = null, busy = false;
const selected = new Set();
const names = {node:'Node.js', xcode:'Xcode', android:'Android', python:'Python', rust:'Rust', go:'Go', java:'Java', flutter:'Flutter', docker:'Docker', ide:'IDEs', macos:'macOS', downloads:'Downloads', logs:'Logs', homebrew:'Homebrew'};
function ageDays(f) {const t = Date.parse(f.last_modified);return Number.isNaN(t) ? null : Math.floor((Date.now()-t)/86400000);}
function ago(days) {if (days === null) return '';if (days < 1) return 'hoje';if (days < 31) return `há ${days} dia(s)`;if (days < 365) return `há ${Math.floor(days/30)} mês(es)`;return `há ${(days/365).toLocaleString('pt-BR',{maximumFractionDigits:1})} ano(s)`;}
// auto_clean comes from the main process, which owns the cleanup policy.
const isStale = f => f.auto_clean && Boolean(f.metadata?.project);
const sum = items => items.reduce((total,f)=>total+f.size_bytes,0);
const risks = {SAFE:'Baixo risco', REVIEW:'Revisar', DANGER:'Alto risco'};
function bytes(n) {if (!n) return '0 B'; const units = ['B','KB','MB','GB','TB'];const i = Math.min(4,Math.floor(Math.log(n)/Math.log(1024)));return `${(n/1024**i).toLocaleString('pt-BR',{maximumFractionDigits:i ? 1 : 0})} ${units[i]}`;}
function node(tag, text, cls) {const el = document.createElement(tag);if (text !== undefined) el.textContent = text;if (cls) el.className = cls;return el;}
function status(text, error=false) {$('status').textContent=text;$('status').className=error?'error':'';}
function render() {
  if (!report) return;
  const query = $('search').value.toLowerCase();
  const items = report.findings.map((f,index)=>({...f,index})).filter(f => (! $('category').value || f.category === $('category').value) && (! $('severity').value || f.severity === $('severity').value) && `${f.name} ${f.path}`.toLowerCase().includes(query));
  items.sort((a,b)=> $('sort').value==='name' ? a.name.localeCompare(b.name) : $('sort').value==='date' ? (Date.parse(b.last_modified)||0)-(Date.parse(a.last_modified)||0) : b.size_bytes-a.size_bytes);
  $('visible-count').textContent = `${items.length} / ${report.findings.length}`;
  $('list').replaceChildren();
  if (!items.length) {$('list').append(node('div', report.findings.length ? 'Nenhum resultado corresponde aos filtros.' : 'Nenhum artefato encontrado nesta análise.', 'empty'));return;}
  for (const f of items) {
    const row = node('div', undefined,'row');
    const check = node('input');check.type='checkbox';check.dataset.index=f.index;check.checked=selected.has(f.index);check.disabled=busy || !f.cleanup_allowed;
    check.setAttribute('aria-label',`Selecionar ${f.path}`);check.title=f.cleanup_reason || 'Enviar à Lixeira';
    check.onchange=()=>{check.checked ? selected.add(f.index) : selected.delete(f.index);selection();};
    const open = node('button', undefined, 'item-details');open.type='button';open.setAttribute('aria-label',`Detalhes de ${f.name}, ${f.path}`);
    const info = node('div',undefined,'row-info');const age=ageDays(f);info.append(node('strong',f.name),node('small',age===null?f.path:`${ago(age)} · ${f.path}`));
    if (!f.cleanup_allowed && f.cleanup_reason) info.append(node('small',`🔒 ${f.cleanup_reason}`,'blocked'));
    open.append(node('span',names[f.category] || f.category,'tool'), info,node('span',risks[f.severity],`badge ${f.severity.toLowerCase()}`),node('span',`${f.size_complete?'':'≥ '}${bytes(f.size_bytes)}`,'size'),node('span','›'));
    open.onclick = ()=>details(f);row.append(check,open);$('list').append(row);
  }
}
function details(f) {
  activeIndex=f.index;$('detail-title').textContent=f.name;
  const body=$('detail-body');body.replaceChildren(node('p',f.description));
  for (const [label,value] of [['Caminho',f.path],['Tamanho e classificação',`${f.size_complete?'':'Medição parcial: pelo menos '}${bytes(f.size_bytes)} · ${risks[f.severity]} · ${f.reclaimable?'Recriável':'Pode conter dados locais'}`],['Última modificação',f.last_modified ? new Date(f.last_modified).toLocaleString('pt-BR') : 'Indisponível'],['Como recriar',f.rebuild?.description || 'Sem instruções de reconstrução.']]) body.append(node('h3',label),node('p',value));
  if(f.rebuild?.commands?.length) body.append(node('pre',f.rebuild.commands.join('\n')));
  body.append(node('h3','Limpeza'),node('p',!f.cleanup_allowed ? f.cleanup_reason : f.auto_clean ? 'Incluído na limpeza automática.' : f.cleanup_review ? 'Pode ir para a Lixeira se você selecionar. Confira antes: pode conter dados que não voltam sozinhos.' : 'Pode ir para a Lixeira se você selecionar.'));
  for (const [key,value] of Object.entries(f.metadata)) body.append(node('h3',key),node('p',value));
  $('details').showModal();
}
$('close').onclick=()=>$('details').close();
$('reveal').onclick=async()=>{try{await window.devclean.reveal(activeIndex);}catch(e){status(e.message,true);$('details').close();}};
for(const id of ['search','category','severity','sort']) $(id).addEventListener(id==='search'?'input':'change',render);
$('export').onclick=async()=>{try{if(await window.devclean.exportReport()) status('Relatório exportado.');}catch(e){status(e.message,true);}};
$('scan').onclick=async()=>{
  setBusy(true);$('scan').textContent='Analisando…';status('Analisando arquivos…');
  try {
    report=await window.devclean.scan();selected.clear();summary();$('count').textContent=`${report.totals.findings} artefatos encontrados`;
    $('category').replaceChildren(new Option('Todas as ferramentas',''));
    for (const c of Object.keys(report.totals.by_category).sort()) $('category').append(new Option(names[c]||c,c));
    $('warnings').replaceChildren(...report.warnings.map(w=>node('p',w)));
    $('timestamp').textContent=`Última análise: ${new Date(report.scanned_at).toLocaleString('pt-BR')}`;
    const safe=report.findings.filter(f=>f.cleanup_allowed).reduce((sum,f)=>sum+f.size_bytes,0);
    status(safe ? `Análise concluída · ${bytes(safe)} podem ir para a Lixeira com segurança` : 'Análise concluída');render();selection();
  } catch(e){status(e.message,true);} finally {setBusy(false);$('scan').textContent='Analisar novamente';}
};

function selectWhere(predicate) {
  if (!report) return;
  selected.clear();
  // Shortest paths first: a folder already selected covers anything inside it.
  const picked=[];
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
  $('total').textContent=bytes(report.totals.bytes);
  $('safe').textContent=bytes(report.findings.filter(f=>f.cleanup_allowed).reduce((sum,f)=>sum+f.size_bytes,0));
  $('review').textContent=bytes((report.totals.by_severity.REVIEW||0)+(report.totals.by_severity.DANGER||0));
  const stale=report.findings.filter(isStale);
  $('select-stale').textContent=`Projetos parados (90+ dias)${stale.length?` · ${bytes(sum(stale))}`:''}`;
  const auto=report.findings.filter(f=>f.auto_clean);
  $('auto').textContent=auto.length?`Limpeza automática · ${bytes(sum(auto))}`:'Limpeza automática';
}
function selection() {
  const total = [...selected].reduce((sum,i)=>sum+(report?.findings[i]?.size_bytes||0),0);
  const review = [...selected].filter(i=>report?.findings[i]?.cleanup_review).length;
  $('selection').textContent = selected.size ? `${selected.size} selecionado(s) · ${bytes(total)}${review?` · ${review} para revisar`:''}` : 'Selecione itens para limpar';
  $('clean').disabled = busy || !selected.size;
  const any = Boolean(report?.findings.some(f=>f.cleanup_allowed));
  $('select-safe').disabled = busy || !any;
  $('select-stale').disabled = busy || !report?.findings.some(isStale);
  $('select-none').disabled = busy || !selected.size;
  $('auto').disabled = busy || !report?.findings.some(f=>f.auto_clean);
}
function setBusy(value) {
  busy=value;$('scan').disabled=value;$('export').disabled=value||!report;
  for(const input of $('list').querySelectorAll('input')) input.disabled=value || !report?.findings[Number(input.dataset.index)]?.cleanup_allowed;
  selection();
  if(report) render();
}
$('clean').onclick=()=>clean(false);
$('auto').onclick=()=>{selectWhere(f=>f.auto_clean);clean(true);};
async function clean(automatic) {
  setBusy(true);status('Validando seleção…');
  try {
    const result=await window.devclean.cleanup([...selected],report.cleanup_token,automatic);
    if(result.canceled) {status('Limpeza cancelada');return;}
    report=result.report;selected.clear();
    summary();$('count').textContent=`${report.totals.findings} artefatos restantes`;
    $('warnings').replaceChildren(...report.warnings.map(w=>node('p',w)),...result.errors.map(e=>node('p',`${e.path}: ${e.message}`)));
    const movedBytes=result.moved.reduce((sum,f)=>sum+f.size_bytes,0);
    status(`${result.moved.length} item(ns) na Lixeira · ${bytes(movedBytes)}. Esvazie a Lixeira para liberar espaço.${result.errors.length?' Alguns itens falharam.':''}`, Boolean(result.errors.length));
  } catch(e){status(e.message,true);} finally {setBusy(false);}
}
// Start the first scan right away: there is nothing to configure.
$('scan').click();
