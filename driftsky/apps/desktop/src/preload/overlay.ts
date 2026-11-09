import { contextBridge, ipcRenderer } from 'electron';
import type { OverlayConfig, WorldFrame } from '../shared/types';

contextBridge.exposeInMainWorld('driftskyOverlay', {
  onConfig: (cb: (c: OverlayConfig) => void) => ipcRenderer.on('config', (_e, c: OverlayConfig) => cb(c)),
  onWorld: (cb: (w: WorldFrame) => void) => ipcRenderer.on('world', (_e, w: WorldFrame) => cb(w)),
});
