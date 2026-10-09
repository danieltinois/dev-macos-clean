// Runs the core scanner in a worker thread so the walk never blocks the Electron main process.
const {Worker, isMainThread, parentPort, workerData} = require('node:worker_threads');
const TIMEOUT_MS = 300000;

if (!isMainThread && workerData?.devcleanScan) {
  const {loadRules, scan} = require('../core/index.cjs');
  parentPort.postMessage(scan(loadRules(), workerData.options));
}

// Scan `home` only, or the whole local disk when no folder is given.
function scan(home) {
  const options = home ? {home} : {globalScan: true};
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {workerData: {devcleanScan: true, options}});
    let settled = false;
    const finish = (error, report) => {
      if (settled) return;
      settled = true; clearTimeout(timer); worker.terminate();
      error ? reject(error) : resolve(report);
    };
    const timer = setTimeout(() => finish(new Error('A análise excedeu 5 minutos. Escolha uma pasta menor.')), TIMEOUT_MS);
    worker.once('message', report => finish(null, report));
    worker.once('error', error => finish(error));
    worker.once('exit', code => finish(new Error(`O analisador parou inesperadamente (código ${code}).`)));
  });
}

module.exports = {scan};
