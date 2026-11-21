import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { ActionResult } from '../shared/types';

const run = promisify(execFile);

/**
 * Copy the bundled wallpaper somewhere the OS can read (not inside the app archive), then set it
 * on every screen. `log` (tests) records the request instead.
 */
export async function setWallpaper(opts: { id: string; sourceDir: string; dataDir: string; platform: NodeJS.Platform; log?: string }): Promise<ActionResult> {
  const src = path.join(opts.sourceDir, `${opts.id}.jpg`);
  if (!/^[a-z]+$/.test(opts.id) || !fs.existsSync(src))
    return { ok: false, message: 'That wallpaper is missing from this copy of Driftsky. Reinstall it from driftsky.app.' };
  const dir = path.join(opts.dataDir, 'wallpapers');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${opts.id}.jpg`);
  fs.copyFileSync(src, dest);

  const log = opts.log;
  if (log) {
    fs.appendFileSync(log, JSON.stringify({ id: opts.id, path: dest, at: Date.now() }) + '\n');
    return { ok: true };
  }
  try {
    if (opts.platform === 'darwin') {
      await setMacWallpaper(dest);
    } else if (opts.platform === 'win32') {
      await setWindowsWallpaper(dest);
    } else {
      const uri = pathToFileURL(dest).href;
      await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri', uri], { timeout: 5000 });
      await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri-dark', uri], { timeout: 5000 }).catch(() => undefined);
      await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-options', 'zoom'], { timeout: 5000 }).catch(() => undefined);
    }
    return { ok: true };
  } catch (e) {
    const msg = String((e as Error).message);
    if (opts.platform === 'darwin' && /not allowed|-1743|authoriz/i.test(msg)) {
      return {
        ok: false,
        message: 'Driftsky needs permission to change your wallpaper. Allow it in System Settings → Privacy & Security → Automation, then try again.',
      };
    }
    return { ok: false, message: 'Couldn’t set the wallpaper. Try again, or set it from your system settings.' };
  }
}

async function setWindowsWallpaper(file: string) {
  // "Fill" so it covers every screen shape, then apply
  await run('reg', ['add', 'HKCU\\Control Panel\\Desktop', '/v', 'WallpaperStyle', '/t', 'REG_SZ', '/d', '10', '/f'], { windowsHide: true, timeout: 5000 });
  await run('reg', ['add', 'HKCU\\Control Panel\\Desktop', '/v', 'TileWallpaper', '/t', 'REG_SZ', '/d', '0', '/f'], { windowsHide: true, timeout: 5000 });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const SystemParametersInfoW = user32.func('int __stdcall SystemParametersInfoW(uint32_t action, uint32_t param, str16 pv, uint32_t winIni)');
  const SPI_SETDESKWALLPAPER = 0x0014;
  const SPIF_UPDATEINIFILE_SENDCHANGE = 0x01 | 0x02;
  if (!SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, file, SPIF_UPDATEINIFILE_SENDCHANGE)) throw new Error('SystemParametersInfoW failed');
}

/**
 * macOS: NSWorkspace.setDesktopImageURL for every screen, through JavaScript for Automation. It runs
 * inside osascript itself, so unlike scripting System Events it needs no Automation permission.
 * The path is passed as an argument, never spliced into the script.
 */
const SET_JXA = `
function run(argv) {
  ObjC.import('AppKit');
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const ws = $.NSWorkspace.sharedWorkspace;
  const screens = $.NSScreen.screens;
  let done = 0;
  for (let i = 0; i < screens.count; i++) {
    const err = Ref();
    if (ws.setDesktopImageURLForScreenOptionsError(url, screens.objectAtIndex(i), $.NSDictionary.dictionary, err)) done++;
  }
  if (done !== screens.count) throw new Error('set ' + done + ' of ' + screens.count + ' screens');
  return String(done);
}`;

const GET_JXA = `
function run() {
  ObjC.import('AppKit');
  const ws = $.NSWorkspace.sharedWorkspace;
  const screens = $.NSScreen.screens;
  const out = [];
  for (let i = 0; i < screens.count; i++) {
    const u = ws.desktopImageURLForScreen(screens.objectAtIndex(i));
    out.push(u.isNil() ? '' : u.path.js);
  }
  return JSON.stringify(out);
}`;

export async function setMacWallpaper(file: string) {
  let problem: Error | null = null;
  try {
    await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SET_JXA, file], { timeout: 15_000 });
  } catch (e) {
    problem = e as Error;
  }
  // the API's return value isn't reliable through the JavaScript bridge: check what's really shown
  const target = fs.realpathSync(file);
  const shown = await getMacWallpapers().catch(() => [] as string[]);
  const real = (p: string) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return p;
    }
  };
  if (shown.length && shown.every((p) => real(p) === target)) return;
  const detail = problem ? `${problem.message} ${(problem as { stderr?: string }).stderr ?? ''}`.trim() : `screens show ${JSON.stringify(shown)}`;
  console.error('[wallpaper] not applied:', detail);
  throw new Error(`wallpaper not applied: ${detail}`);
}

/** The wallpaper file currently shown on each screen (macOS). */
export async function getMacWallpapers(): Promise<string[]> {
  const { stdout } = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', GET_JXA], { timeout: 15_000 });
  return JSON.parse(stdout.trim());
}
