import fs from 'node:fs';
import type { ScreenWindow, WindowSource } from './types';
import { emptySource } from './types';

export type { ScreenWindow, WindowSource } from './types';

/**
 * A window list read from a JSON file, re-read when it changes. Used by the automated tests (and
 * handy for demos): DRIFTSKY_FAKE_WINDOWS=/path/windows.json with [{id,x,y,w,h}, …] front-to-back.
 */
export function fileWindowSource(file: string): WindowSource {
  let mtime = -1;
  let cache: ScreenWindow[] = [];
  return {
    name: 'file',
    list() {
      try {
        const st = fs.statSync(file);
        if (st.mtimeMs !== mtime) {
          mtime = st.mtimeMs;
          const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
          cache = Array.isArray(parsed)
            ? parsed
                .filter((w) => w && [w.x, w.y, w.w, w.h].every((v: unknown) => typeof v === 'number' && Number.isFinite(v)))
                .map((w, i) => ({ id: String(w.id ?? i), x: w.x, y: w.y, w: w.w, h: w.h }))
            : [];
        }
      } catch {
        /* keep the last good list while the file is being rewritten */
      }
      return cache;
    },
  };
}

export function createWindowSource(opts: { platform: NodeJS.Platform; pid: number; toDip?: (r: { x: number; y: number; width: number; height: number }) => { x: number; y: number; width: number; height: number } }): WindowSource {
  const fake = process.env.DRIFTSKY_FAKE_WINDOWS;
  if (fake) return fileWindowSource(fake);
  try {
    if (opts.platform === 'darwin') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./mac').macWindowSource(opts.pid);
    }
    if (opts.platform === 'win32') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./win').winWindowSource(opts.pid, opts.toDip ?? ((r: never) => r));
    }
    if (opts.platform === 'linux') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('./linux').linuxWindowSource(opts.pid);
    }
  } catch (e) {
    console.error('[windows] native window list unavailable, weather will fall to the bottom of the screen only:', (e as Error).message);
  }
  return emptySource;
}
