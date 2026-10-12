// Worker thread entry started by scan.ts: runs one scan and posts the report back.
import {parentPort, workerData} from 'node:worker_threads';
import {loadRules, scan} from '../core';
import type {ScanOptions} from '../core/scanner';

export interface ScanRequest {rulesDir: string; options: Partial<ScanOptions>}

if (parentPort) {
  const {rulesDir, options} = workerData as ScanRequest;
  parentPort.postMessage(scan(loadRules(rulesDir), options));
}
