import { contextBridge, ipcRenderer } from 'electron';
import type { ActionResult, AppState, Settings, UpdateState } from '../shared/types';

const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('state'),
  onState: (cb: (s: AppState) => void) => {
    const h = (_e: unknown, s: AppState) => cb(s);
    ipcRenderer.on('state', h);
    return () => ipcRenderer.removeListener('state', h);
  },
  onNavigate: (cb: (tab: string) => void) => {
    const h = (_e: unknown, t: string) => cb(t);
    ipcRenderer.on('navigate', h);
    return () => ipcRenderer.removeListener('navigate', h);
  },
  setEffect: (id: string): Promise<ActionResult> => ipcRenderer.invoke('set-effect', id),
  setWallpaper: (id: string): Promise<ActionResult> => ipcRenderer.invoke('set-wallpaper', id),
  setSettings: (p: Partial<Settings>): Promise<ActionResult> => ipcRenderer.invoke('set-settings', p),
  activate: (key: string): Promise<ActionResult> => ipcRenderer.invoke('activate', key),
  removeKey: (force = false): Promise<ActionResult> => ipcRenderer.invoke('remove-key', force),
  preview: (): Promise<ActionResult> => ipcRenderer.invoke('preview'),
  buy: (): Promise<void> => ipcRenderer.invoke('buy'),
  upgrade: (): Promise<void> => ipcRenderer.invoke('upgrade'),
  openLink: (url: string): Promise<void> => ipcRenderer.invoke('open-link', url),
  checkUpdates: (): Promise<UpdateState> => ipcRenderer.invoke('check-updates'),
  installUpdate: (): Promise<UpdateState> => ipcRenderer.invoke('install-update'),
  finishOnboarding: (): Promise<void> => ipcRenderer.invoke('finish-onboarding'),
};

export type DriftskyApi = typeof api;
contextBridge.exposeInMainWorld('driftsky', api);
