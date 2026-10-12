// Runs the core scanner in a worker thread so the walk never blocks the Electron main process.
import {Worker} from 'node:worker_threads';
import type {Report} from '../core';
import type {ScanRequest} from './scan-worker';

const TIMEOUT_MS = 300000;

// Where the worker script and rules live. Passed in by the caller because the bundler
// inlines __dirname/import.meta.dirname as build-time paths.
export interface ScanPaths {worker: string; rulesDir: string}

// Scan `home` only, or the whole local disk when no folder is given.
export function scan({worker: script, rulesDir}: ScanPaths, home?: string): Promise<Report> {
  const workerData: ScanRequest = {rulesDir, options: home ? {home} : {globalScan: true}};
  return new Promise((resolve, reject) => {
    const worker = new Worker(script, {workerData});
    let settled = false;
    const finish = (error: Error | null, report?: Report) => {
      if (settled) return;
      settled = true; clearTimeout(timer); worker.terminate();
      error ? reject(error) : resolve(report!);
    };
    const timer = setTimeout(() => finish(new Error('A análise excedeu 5 minutos. Escolha uma pasta menor.')), TIMEOUT_MS);
    worker.once('message', report => finish(null, report));
    worker.once('error', error => finish(error));
    worker.once('exit', code => finish(new Error(`O analisador parou inesperadamente (código ${code}).`)));
  });
}
