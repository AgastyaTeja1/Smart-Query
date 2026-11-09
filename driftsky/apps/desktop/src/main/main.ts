import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  Tray,
  nativeImage,
  powerMonitor,
  screen,
  shell,
  ipcMain,
  dialog,
  type Display,
  type MenuItemConstructorOptions,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { EFFECTS, WALLPAPERS, isEffectId, type EffectId, type WallpaperId } from '@driftsky/engine';
import type { ActionResult, AppState, OverlayConfig, Platform, PreviewState, Settings } from '../shared/types';
import { Store } from './store';
import { LicenseManager } from './license';
import { Updater } from './updater';
import { buildMenu, type MenuAction, type MenuSpec } from './menu';
import { createWindowSource, type WindowSource } from './windowsource';
import { frameFor } from './geometry';
import { setWallpaper } from './wallpaper';

// ---------------------------------------------------------------- environment

const PLATFORM: Platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';
/** DRIFTSKY_* overrides exist for development and tests; a shipped build ignores them. */
const env = (k: string) => (app.isPackaged ? undefined : process.env[k]);
const SITE = (env('DRIFTSKY_SITE') || 'https://driftsky.app').replace(/\/+$/, '');
const API = (env('DRIFTSKY_API') || SITE).replace(/\/+$/, '');
const TEST = env('DRIFTSKY_TEST') === '1';
const PREVIEW_MS = Number(env('DRIFTSKY_PREVIEW_MS')) || 60_000;
/** "Behind windows" needs the desktop window level, which only macOS offers cleanly. */
const CAN_GO_BEHIND = PLATFORM === 'mac';
const LINKS = {
  site: SITE,
  buy: `${SITE}/#pricing`,
  privacy: `${SITE}/privacy`,
  terms: `${SITE}/terms`,
  lostKey: `${SITE}/lost-key`,
  support: 'mailto:support@driftsky.app',
};
const ROOT = path.join(__dirname, '..');
const resource = (...p: string[]) => (app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(ROOT, 'resources', ...p));

if (env('DRIFTSKY_USER_DATA')) app.setPath('userData', env('DRIFTSKY_USER_DATA')!);
// one Driftsky at a time: a second launch just opens Settings in the first, then exits at once
const primary = TEST || app.requestSingleInstanceLock();
if (!primary) app.exit(0);
// transparent overlays on Linux need this; harmless elsewhere
if (PLATFORM === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');

// ---------------------------------------------------------------- state

let store: Store;
let license: LicenseManager;
let updater: Updater;
let tray: Tray | null = null;
let settingsWin: BrowserWindow | null = null;
let windowSource: WindowSource;
let preview: PreviewState = { active: false, endsAt: null, used: false };
let previewTimer: NodeJS.Timeout | null = null;
let paused: AppState['paused'] = null;
const pauses = { locked: false, suspended: false };
let onBattery = false;
const overlays = new Map<number, { win: BrowserWindow; display: Display; ready: boolean; fullscreen: boolean }>();
let tick: NodeJS.Timeout | null = null;
let quitting = false;

function appState(): AppState {
  const s = store.data.settings;
  const allowed = license.isLicensed || preview.active;
  return {
    version: app.getVersion(),
    platform: PLATFORM,
    settings: s,
    license: license.state,
    update: updater.state,
    preview,
    running: allowed && s.effect !== 'off' && !paused,
    paused: paused ?? (s.pauseInFullScreen && overlays.size > 0 && [...overlays.values()].every((o) => o.fullscreen) ? 'fullscreen' : null),
    canGoBehind: CAN_GO_BEHIND,
    onBattery,
    links: LINKS,
  };
}

/** Push state everywhere: tray, settings window, overlays. */
function broadcast() {
  if (!store) return;
  const st = appState();
  refreshTray(st);
  settingsWin?.webContents.send('state', st);
  syncOverlays(st);
}

// ---------------------------------------------------------------- overlays

function overlayConfig(st: AppState, fullscreen: boolean): OverlayConfig {
  const allowed = st.license.status === 'active' || st.preview.active;
  return {
    effect: allowed ? st.settings.effect : 'off',
    intensity: st.settings.intensity,
    lowPower: st.onBattery && st.settings.batterySaver,
    paused: !!st.paused || (fullscreen && st.settings.pauseInFullScreen),
  };
}

function createOverlay(display: Display) {
  const behind = CAN_GO_BEHIND && store.data.settings.behindWindows;
  const b = display.bounds;
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // non-resizable transparent windows come out 1px short on Linux
    resizable: PLATFORM === 'linux',
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    // behind windows on Mac: the desktop level, under every app window
    ...(PLATFORM === 'mac' && behind ? { type: 'desktop' } : {}),
    ...(PLATFORM === 'linux' ? { type: 'dock' } : {}),
    title: 'Driftsky overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  // clicks always go straight through to what's underneath
  win.setIgnoreMouseEvents(true);
  if (!behind) win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setBounds(b);
  lockDown(win);
  const entry = { win, display, ready: false, fullscreen: false };
  overlays.set(display.id, entry);
  win.webContents.once('did-finish-load', () => {
    entry.ready = true;
    win.webContents.send('config', overlayConfig(appState(), false));
    win.showInactive();
    // some window managers adjust a window as it's shown: put it back over the whole display
    win.setBounds(display.bounds);
  });
  win.on('closed', () => overlays.delete(display.id));
  win.loadFile(path.join(__dirname, 'renderer/overlay/index.html'));
}

function rebuildOverlays() {
  for (const o of overlays.values()) o.win.destroy();
  overlays.clear();
  for (const d of screen.getAllDisplays()) createOverlay(d);
}

function syncOverlays(st = appState()) {
  for (const o of overlays.values()) if (o.ready && !o.win.isDestroyed()) o.win.webContents.send('config', overlayConfig(st, o.fullscreen));
}

/** 60 Hz: pointer every tick, the window list every other tick (30 Hz; 15 Hz on battery). */
function startTicker() {
  stopTicker();
  let n = 0;
  let windows = windowSource.list();
  tick = setInterval(() => {
    const st = store.data.settings;
    const active = (license.isLicensed || preview.active) && st.effect !== 'off' && !paused;
    if (!active || overlays.size === 0) return;
    n++;
    const every = onBattery && st.batterySaver ? 4 : 2;
    if (n % every === 0) {
      try {
        windows = windowSource.list();
      } catch (e) {
        console.error('[windows]', (e as Error).message);
      }
    }
    const cursor = screen.getCursorScreenPoint();
    for (const o of overlays.values()) {
      if (!o.ready || o.win.isDestroyed()) continue;
      const f = frameFor(o.display, windows, cursor, CAN_GO_BEHIND && st.behindWindows);
      if (f.fullscreen !== o.fullscreen) {
        o.fullscreen = f.fullscreen;
        refreshTray(appState());
        o.win.webContents.send('config', overlayConfig(appState(), f.fullscreen));
      }
      o.win.webContents.send('world', { windows: f.windows, floor: f.floor, pointer: f.pointer });
    }
  }, 1000 / 60);
}

function stopTicker() {
  if (tick) clearInterval(tick);
  tick = null;
}

// ---------------------------------------------------------------- tray

function trayIcon() {
  if (PLATFORM === 'mac') {
    const img = nativeImage.createFromPath(resource('icons', 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(resource('icons', PLATFORM === 'windows' ? 'icon-32.png' : 'tray-light.png'));
}

function toElectronMenu(specs: MenuSpec[]): MenuItemConstructorOptions[] {
  return specs.map((s) => {
    if (s.type === 'separator') return { type: 'separator' };
    const item: MenuItemConstructorOptions = { id: s.id, label: s.label, enabled: s.enabled ?? true, accelerator: s.accelerator };
    if (s.type === 'radio' || s.type === 'checkbox') {
      item.type = s.type;
      item.checked = !!s.checked;
    }
    if (s.submenu) item.submenu = toElectronMenu(s.submenu);
    if (s.action) {
      const a = s.action;
      item.click = () => void runAction(a);
    }
    return item;
  });
}

function refreshTray(st: AppState) {
  if (!tray || tray.isDestroyed()) return;
  tray.setToolTip(`Driftsky${st.settings.effect !== 'off' && st.running ? ` · ${st.settings.effect}` : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate(toElectronMenu(buildMenu(st))));
}

async function runAction(a: MenuAction): Promise<ActionResult> {
  switch (a.kind) {
    case 'effect':
      return setEffect(a.effect);
    case 'wallpaper':
      return applyWallpaper(a.wallpaper);
    case 'intensity':
      store.updateSettings({ intensity: a.value });
      break;
    case 'toggle':
      if (!CAN_GO_BEHIND) break;
      store.updateSettings({ behindWindows: !store.data.settings.behindWindows });
      rebuildOverlays();
      break;
    case 'open':
      openSettings(a.tab);
      break;
    case 'buy':
      await shell.openExternal(LINKS.buy);
      break;
    case 'upgrade': {
      const url = await license.upgradeUrl(SITE);
      if (url) await shell.openExternal(url);
      break;
    }
    case 'preview':
      return startPreview();
    case 'update':
      await updater.install();
      break;
    case 'check-updates':
      await updater.check(true);
      if (updater.state.status === 'up-to-date' && !settingsWin)
        void dialog.showMessageBox({ message: 'Driftsky is up to date.', detail: `You have version ${app.getVersion()}.`, buttons: ['OK'] });
      break;
    case 'quit':
      quitting = true;
      app.quit();
      break;
  }
  broadcast();
  return { ok: true };
}

function setEffect(effect: EffectId | 'off'): ActionResult {
  if (effect !== 'off' && !isEffectId(effect)) return { ok: false, message: 'Unknown effect.' };
  if (!license.isLicensed && !preview.active) return { ok: false, message: 'Add your license key to turn on the weather, or try it for a minute first.' };
  store.updateSettings({ effect });
  broadcast();
  return { ok: true };
}

async function applyWallpaper(id: WallpaperId): Promise<ActionResult> {
  if (!WALLPAPERS.some((w) => w.id === id)) return { ok: false, message: 'Unknown wallpaper.' };
  if (!license.isLicensed && !preview.active) return { ok: false, message: 'The wallpapers come with Driftsky. Add your key to use them.' };
  const r = await setWallpaper({
    id,
    sourceDir: resource('wallpapers'),
    dataDir: app.getPath('userData'),
    platform: process.platform,
    log: TEST ? env('DRIFTSKY_WALLPAPER_LOG') : undefined,
  });
  if (r.ok) store.updateSettings({ wallpaper: id });
  broadcast();
  return r;
}

function startPreview(): ActionResult {
  if (license.isLicensed) return { ok: true };
  if (store.data.preview.used || preview.active) return { ok: false, message: 'You’ve had your preview. Add a key to keep the weather.' };
  preview = { active: true, endsAt: Date.now() + PREVIEW_MS, used: true };
  store.data.preview.used = true;
  store.save();
  if (store.data.settings.effect === 'off') store.updateSettings({ effect: store.data.settings.lastEffect });
  previewTimer = setTimeout(() => {
    preview = { active: false, endsAt: null, used: true };
    broadcast();
    if (!license.isLicensed) openSettings('license');
  }, PREVIEW_MS);
  broadcast();
  return { ok: true, message: 'Enjoy a minute of weather.' };
}

// ---------------------------------------------------------------- settings window

function openSettings(tab = 'effects') {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('navigate', tab);
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return settingsWin;
  }
  settingsWin = new BrowserWindow({
    width: 820,
    height: 580,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'Driftsky',
    backgroundColor: '#f5f5f7',
    ...(PLATFORM === 'mac'
      ? { titleBarStyle: 'hiddenInset' as const, vibrancy: 'sidebar' as const, trafficLightPosition: { x: 18, y: 18 } }
      : { autoHideMenuBar: true, icon: resource('icons', 'icon-256.png') }),
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  lockDown(settingsWin);
  settingsWin.loadFile(path.join(__dirname, 'renderer/settings/index.html'), { hash: tab });
  settingsWin.once('ready-to-show', () => {
    settingsWin?.show();
    if (PLATFORM === 'mac') app.dock?.show().catch(() => undefined);
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
    // a menu bar app: no Dock icon unless a window is open
    if (PLATFORM === 'mac') app.dock?.hide();
  });
  return settingsWin;
}

/** No navigation, no new windows, no permission prompts from web content. */
function lockDown(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}

function isSafeExternal(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol === 'mailto:') return true;
    const site = new URL(SITE);
    return (u.protocol === 'https:' || (TEST && u.protocol === 'http:')) && u.host === site.host;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- IPC (settings window)

const settingsPatch = z
  .object({
    intensity: z.number().min(0.25).max(2),
    behindWindows: z.boolean(),
    openAtLogin: z.boolean(),
    batterySaver: z.boolean(),
    pauseInFullScreen: z.boolean(),
    autoUpdate: z.boolean(),
  })
  .partial()
  .strict();

function registerIpc() {
  const fromSettings = (e: Electron.IpcMainInvokeEvent) => !!settingsWin && e.sender === settingsWin.webContents;
  const handle = (ch: string, fn: (...a: any[]) => unknown) =>
    ipcMain.handle(ch, async (e, ...args) => {
      if (!fromSettings(e)) throw new Error('not allowed');
      return fn(...args);
    });

  handle('state', () => appState());
  handle('set-effect', (id: unknown) => setEffect(typeof id === 'string' && (id === 'off' || isEffectId(id)) ? (id as EffectId | 'off') : ('bad' as never)));
  handle('set-wallpaper', (id: unknown) => applyWallpaper(id as WallpaperId));
  handle('set-settings', (patch: unknown) => {
    const p = settingsPatch.safeParse(patch);
    if (!p.success) return { ok: false, message: 'Invalid setting.' };
    const before = store.data.settings;
    const next = store.updateSettings(p.data as Partial<Settings>);
    if (p.data.openAtLogin !== undefined) applyLoginItem(next.openAtLogin);
    if (p.data.behindWindows !== undefined && !CAN_GO_BEHIND) return { ok: false, message: 'Behind windows is available on Mac.' };
    if (p.data.behindWindows !== undefined && p.data.behindWindows !== before.behindWindows) rebuildOverlays();
    broadcast();
    return { ok: true };
  });
  handle('activate', async (key: unknown) => {
    const r = await license.activate(typeof key === 'string' ? key.slice(0, 200) : '');
    if (r.ok) {
      if (previewTimer) clearTimeout(previewTimer);
      preview = { ...preview, active: false, endsAt: null };
      if (store.data.settings.effect === 'off' && !store.data.settings.onboarded) store.updateSettings({ effect: store.data.settings.lastEffect });
    }
    broadcast();
    return r;
  });
  handle('remove-key', async (force: unknown) => {
    const r = await license.remove(force === true);
    broadcast();
    return r;
  });
  handle('preview', () => startPreview());
  handle('copy-key', () => {
    if (!license.state.key) return { ok: false, message: 'No key on this computer.' };
    clipboard.writeText(license.state.key);
    return { ok: true, message: 'Key copied.' };
  });
  handle('recheck', async () => {
    await license.validate();
    broadcast();
    return license.isLicensed
      ? { ok: true, message: 'Your key works again.' }
      : { ok: false, message: license.state.message ?? 'The key still isn’t working on this computer.' };
  });
  handle('buy', () => shell.openExternal(LINKS.buy));
  handle('upgrade', async () => {
    const url = await license.upgradeUrl(SITE);
    if (url) await shell.openExternal(url);
  });
  handle('open-link', (url: unknown) => (typeof url === 'string' && isSafeExternal(url) ? shell.openExternal(url) : undefined));
  handle('check-updates', () => updater.check(true));
  handle('install-update', () => updater.install());
  handle('finish-onboarding', () => {
    store.updateSettings({ onboarded: true });
    broadcast();
  });
}

function applyLoginItem(open: boolean) {
  if (TEST || PLATFORM === 'linux') return;
  try {
    app.setLoginItemSettings({ openAtLogin: open, openAsHidden: true });
  } catch (e) {
    console.error('[login item]', (e as Error).message);
  }
}

// ---------------------------------------------------------------- power

function setPaused(p: AppState['paused']) {
  paused = p;
  broadcast();
}

function updatePause(k: keyof typeof pauses, v: boolean) {
  pauses[k] = v;
  setPaused(pauses.suspended ? 'suspended' : pauses.locked ? 'locked' : null);
}

function watchPower() {
  onBattery = powerMonitor.isOnBatteryPower();
  powerMonitor.on('on-battery', () => ((onBattery = true), broadcast()));
  powerMonitor.on('on-ac', () => ((onBattery = false), broadcast()));
  powerMonitor.on('lock-screen', () => updatePause('locked', true));
  powerMonitor.on('unlock-screen', () => updatePause('locked', false));
  powerMonitor.on('suspend', () => updatePause('suspended', true));
  // waking from sleep doesn't mean the screen is unlocked
  powerMonitor.on('resume', () => updatePause('suspended', false));
}

// ---------------------------------------------------------------- lifecycle

app.on('second-instance', () => openSettings());

app.whenReady().then(async () => {
  if (!primary) return;
  if (PLATFORM === 'mac') app.dock?.hide();
  store = new Store(app.getPath('userData'));
  let wasLicensed = !!store.data.license.key && store.data.license.status === 'active';
  license = new LicenseManager(
    store,
    API,
    PLATFORM,
    app.getVersion(),
    () => {
      // the key just stopped working (revoked, removed elsewhere, offline too long): say so
      const now = license?.isLicensed ?? false;
      if (wasLicensed && !now && license?.state.key) setImmediate(() => openSettings('license'));
      wasLicensed = now;
      broadcast();
    },
    fetch,
    env('DRIFTSKY_DEVICE_ID'),
  );
  const openLog = TEST ? env('DRIFTSKY_OPEN_LOG') : undefined;
  const openInstaller = openLog ? async (f: string) => (fs.appendFileSync(openLog, f + '\n'), '') : (f: string) => shell.openPath(f);
  updater = new Updater(API, PLATFORM, app.getVersion(), () => broadcast(), openInstaller, fetch, TEST);
  preview.used = store.data.preview.used;
  windowSource = createWindowSource({
    platform: process.platform,
    pid: process.pid,
    toDip: (r) => screen.screenToDipRect(null, r),
    fakeFile: env('DRIFTSKY_FAKE_WINDOWS'),
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      PLATFORM === 'mac'
        ? [
            {
              role: 'appMenu',
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                { label: 'Settings…', accelerator: 'Command+,', click: () => openSettings() },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'quit' },
              ],
            },
            { role: 'editMenu' },
            { role: 'windowMenu' },
          ]
        : [{ role: 'editMenu' }],
    ),
  );

  registerIpc();
  watchPower();
  applyLoginItem(store.data.settings.openAtLogin);

  tray = new Tray(trayIcon());
  if (PLATFORM === 'windows') tray.on('click', () => openSettings());
  refreshTray(appState());

  rebuildOverlays();
  screen.on('display-added', rebuildOverlays);
  screen.on('display-removed', rebuildOverlays);
  // a work-area or scale change (Dock resized, taskbar auto-hide): move the overlay, keep the snow
  screen.on('display-metrics-changed', (_e, display) => {
    const o = overlays.get(display.id);
    if (!o || o.win.isDestroyed()) return rebuildOverlays();
    o.display = display;
    o.win.setBounds(display.bounds);
  });
  startTicker();

  if (!store.data.settings.onboarded || !license.isLicensed) openSettings(store.data.settings.onboarded ? 'license' : 'welcome');

  // check the key now and daily; updates shortly after launch and every 6 hours
  void license.validate();
  setInterval(() => void license.validate(), 24 * 3600_000).unref();
  if (!TEST) {
    const auto = async () => {
      if (!store.data.settings.autoUpdate) return;
      const u = await updater.check();
      // below the minimum version: don't bury it in the menu
      if (u.required && (u.status === 'available' || u.status === 'ready')) openSettings('about');
    };
    setTimeout(() => void auto(), 30_000).unref();
    setInterval(() => void auto(), 6 * 3600_000).unref();
  }

  if (TEST) exposeTestHooks();
});

// a menu bar app keeps running with no windows open
app.on('window-all-closed', () => undefined);
app.on('before-quit', () => {
  quitting = true;
  stopTicker();
  windowSource?.dispose?.();
});
app.on('activate', () => openSettings());
void quitting;

// ---------------------------------------------------------------- test hooks

function exposeTestHooks() {
  (globalThis as Record<string, unknown>).__driftsky = {
    state: () => appState(),
    menu: () => buildMenu(appState()),
    runMenu: async (id: string) => {
      const find = (items: MenuSpec[]): MenuSpec | undefined => {
        for (const i of items) {
          if (i.id === id) return i;
          const sub = i.submenu && find(i.submenu);
          if (sub) return sub;
        }
      };
      const item = find(buildMenu(appState()));
      if (!item?.action) throw new Error(`no menu action ${id}`);
      if (item.enabled === false) throw new Error(`menu item ${id} is disabled`);
      return runAction(item.action);
    },
    overlays: () =>
      [...overlays.values()].map((o) => ({
        id: o.display.id,
        bounds: o.win.getBounds(),
        visible: o.win.isVisible(),
        ready: o.ready,
        ignoresMouse: true,
        alwaysOnTop: o.win.isAlwaysOnTop(),
        focusable: o.win.isFocusable(),
      })),
    overlayStats: () => Promise.all([...overlays.values()].map((o) => o.win.webContents.executeJavaScript('window.__overlay && window.__overlay.stats()'))),
    setBattery: (v: boolean) => {
      onBattery = v;
      broadcast();
    },
    setPaused: (p: AppState['paused']) => setPaused(p),
    openSettings: (tab?: string) => void openSettings(tab),
    settingsOpen: () => !!settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible(),
    validate: () => license.validate(),
    checkUpdates: () => updater.check(true),
    effects: EFFECTS,
    canGoBehind: CAN_GO_BEHIND,
    power: (ev: 'lock-screen' | 'unlock-screen' | 'suspend' | 'resume') => powerMonitor.emit(ev as never),
  };
}
