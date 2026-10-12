import {contextBridge, ipcRenderer} from 'electron';
import type {CleanupOutcome, CleanupReport} from './cleanup';

// The API the page sees as `window.devclean`.
export interface DevcleanBridge {
  cleanup(indices: number[], token: string, automatic: boolean): Promise<{canceled: true} | (CleanupOutcome & {canceled?: undefined; report: CleanupReport})>;
  scan(): Promise<CleanupReport>;
  reveal(index: number): Promise<void>;
  exportReport(): Promise<boolean>;
}

const bridge: DevcleanBridge = {
  cleanup: (indices, token, automatic) => ipcRenderer.invoke('cleanup', indices, token, automatic === true),
  scan: () => ipcRenderer.invoke('scan'),
  reveal: index => ipcRenderer.invoke('reveal', index),
  exportReport: () => ipcRenderer.invoke('export'),
};
contextBridge.exposeInMainWorld('devclean', bridge);
