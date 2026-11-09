import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ActionResult } from '../shared/types';

const run = promisify(execFile);

/**
 * Copy the bundled wallpaper somewhere the OS can read (not inside the app archive), then set it
 * on every screen. DRIFTSKY_WALLPAPER_LOG makes this record the request instead (tests).
 */
export async function setWallpaper(opts: { id: string; sourceDir: string; dataDir: string; platform: NodeJS.Platform }): Promise<ActionResult> {
  const src = path.join(opts.sourceDir, `${opts.id}.jpg`);
  if (!/^[a-z]+$/.test(opts.id) || !fs.existsSync(src)) return { ok: false, message: 'That wallpaper is missing from this copy of Driftsky. Reinstall it from driftsky.app.' };
  const dir = path.join(opts.dataDir, 'wallpapers');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${opts.id}.jpg`);
  fs.copyFileSync(src, dest);

  const log = process.env.DRIFTSKY_WALLPAPER_LOG;
  if (log) {
    fs.appendFileSync(log, JSON.stringify({ id: opts.id, path: dest, at: Date.now() }) + '\n');
    return { ok: true };
  }
  try {
    if (opts.platform === 'darwin') {
      // every desktop = every screen and Space currently known
      const script = `tell application "System Events" to tell every desktop to set picture to POSIX file ${JSON.stringify(dest)}`;
      await run('/usr/bin/osascript', ['-e', script], { timeout: 15_000 });
    } else if (opts.platform === 'win32') {
      await setWindowsWallpaper(dest);
    } else {
      const uri = `file://${dest}`;
      await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri', uri], { timeout: 5000 });
      await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri-dark', uri], { timeout: 5000 }).catch(() => undefined);
      await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-options', 'zoom'], { timeout: 5000 }).catch(() => undefined);
    }
    return { ok: true };
  } catch (e) {
    const msg = String((e as Error).message);
    if (opts.platform === 'darwin' && /not allowed|-1743|authoriz/i.test(msg)) {
      return { ok: false, message: 'Driftsky needs permission to change your wallpaper. Allow it in System Settings → Privacy & Security → Automation, then try again.' };
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
  const SystemParametersInfoW = user32.func('bool __stdcall SystemParametersInfoW(uint32_t action, uint32_t param, str16 pv, uint32_t winIni)');
  const SPI_SETDESKWALLPAPER = 0x0014;
  const SPIF_UPDATEINIFILE_SENDCHANGE = 0x01 | 0x02;
  if (!SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, file, SPIF_UPDATEINIFILE_SENDCHANGE)) throw new Error('SystemParametersInfoW failed');
}
