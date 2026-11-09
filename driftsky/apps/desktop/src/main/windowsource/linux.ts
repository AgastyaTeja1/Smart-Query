import { execFile } from 'node:child_process';
import type { ScreenWindow, WindowSource } from './types';

/**
 * Linux/X11 (development convenience, not a shipping target): asks the window manager for its
 * stacking list with xprop and geometry with xwininfo, a few times a second in the background,
 * and serves the latest result. Without those tools (or on Wayland) it reports no windows.
 */
export function linuxWindowSource(ownPid: number, intervalMs = 250): WindowSource {
  let latest: ScreenWindow[] = [];
  let busy = false;
  let stopped = false;

  const sh = (cmd: string, args: string[]) =>
    new Promise<string>((resolve) => execFile(cmd, args, { timeout: 1000 }, (err, out) => resolve(err ? '' : String(out))));

  const poll = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const stack = await sh('xprop', ['-root', '_NET_CLIENT_LIST_STACKING']);
      const ids = stack.match(/0x[0-9a-f]+/gi) ?? [];
      const wins: ScreenWindow[] = [];
      for (const id of ids.reverse()) {
        const props = await sh('xprop', ['-id', id, '_NET_WM_PID', '_NET_WM_STATE']);
        if (props.includes(`= ${ownPid}`) || props.includes('_NET_WM_STATE_HIDDEN')) continue;
        const info = await sh('xwininfo', ['-id', id]);
        const n = (k: string) => Number(info.match(new RegExp(`${k}:\\s+(-?\\d+)`))?.[1]);
        const x = n('Absolute upper-left X');
        const y = n('Absolute upper-left Y');
        const w = n('Width');
        const h = n('Height');
        if ([x, y, w, h].every(Number.isFinite) && info.includes('IsViewable')) wins.push({ id, x, y, w, h });
      }
      latest = wins;
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(poll, intervalMs);
  poll();
  return {
    name: 'linux',
    list: () => latest,
    dispose() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
