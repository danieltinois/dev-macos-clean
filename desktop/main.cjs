const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const { writeFile } = require('node:fs/promises');
const { scan } = require('./scan.cjs');
const cleanup = require('./cleanup.cjs');
const os = require('node:os');
let window, report = null, busy = false, manifest = new Map();
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Origem inválida');
}
ipcMain.handle('scan', async event => {
  trusted(event);
  if (busy) throw new Error('Uma análise já está em andamento.');
  busy = true;
  try {
    const prepared = await cleanup.prepare(await scan(), os.homedir(), path.resolve(__dirname, '..'));
    report = prepared.report; manifest = prepared.manifest; return report;
  } finally {busy = false;}
});
ipcMain.handle('cleanup', async (event, indices, token, automatic) => {
  trusted(event);
  if (busy) throw new Error('Aguarde a operação atual.');
  busy = true;
  try {
    const selected = cleanup.select(report, indices, token);
    if (automatic === true && selected.some(f => !f.auto_clean)) throw new Error('Item não autorizado para limpeza automática.');
    await cleanup.validate(selected, manifest);
    const total = selected.reduce((sum, f) => sum + f.size_bytes, 0);
    const review = selected.filter(f => f.cleanup_review);
    const list = items => items.length > 25 ? `${items.slice(0, 25).map(f => f.path).join('\n')}\n… e mais ${items.length - 25}\n\n` : items.length ? `${items.map(f => f.path).join('\n')}\n\n` : '';
    const result = await dialog.showMessageBox(window, {
      type: 'warning', title: automatic === true ? 'Limpeza automática' : 'Enviar à Lixeira',
      message: automatic === true ? `Limpeza automática: mover ${selected.length} cache(s) e dependência(s) para a Lixeira?` : `Mover ${selected.length} item(ns) para a Lixeira?`,
      detail: `${(total / 1024**2).toLocaleString('pt-BR', {maximumFractionDigits: 1})} MB selecionados.\n\n${list(selected.filter(f => !f.cleanup_review))}${review.length ? `⚠️ PARA REVISAR — podem conter dados que não voltam sozinhos (AVDs, archives, logs, caches de apps):\n${list(review)}` : ''}Feche builds e ferramentas que usam estes diretórios. Dependências precisarão ser reinstaladas e caches serão recriados.\n\nVocê pode restaurar pelo Finder. O espaço no disco só é liberado após esvaziar a Lixeira.`,
      buttons: ['Cancelar', 'Enviar à Lixeira'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response !== 1) return {canceled:true};
    const outcome = await cleanup.moveToTrash(selected, manifest, target => shell.trashItem(target));
    report = cleanup.remainingReport(report, outcome.moved);
    return {...outcome, report};
  } finally {busy = false;}
});
ipcMain.handle('reveal', (event, index) => {
  trusted(event);
  if (!Number.isInteger(index) || !report?.findings[index]) throw new Error('Item inválido');
  shell.showItemInFolder(report.findings[index].path);
});
ipcMain.handle('export', async event => {
  trusted(event);
  if (!report) throw new Error('Faça uma análise primeiro.');
  const result = await dialog.showSaveDialog(window, {defaultPath: 'devclean-report.json', filters: [{name: 'JSON', extensions: ['json']}]});
  if (result.canceled) return false;
  await writeFile(result.filePath, JSON.stringify(report, null, 2));
  return true;
});
function createWindow() {
  window = new BrowserWindow({width: 1280, height: 850, minWidth: 900, minHeight: 650, title: 'DevClean', backgroundColor: '#191b1e', titleBarStyle: 'hiddenInset', webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadFile(path.join(__dirname, 'index.html'));
}
app.whenReady().then(() => {createWindow(); app.on('activate', () => {if (!BrowserWindow.getAllWindows().length) createWindow();});});
app.on('window-all-closed', () => {if (process.platform !== 'darwin') app.quit();});
