import type { ScreenWindow, WindowSource } from './types';

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Windows: EnumWindows walks top-level windows in Z order (front first). DWM's extended frame
 * bounds give the visible rectangle without the invisible resize borders. Cloaked windows (other
 * virtual desktops, suspended UWP apps), minimised, tool and no-activate windows are skipped.
 * Coordinates are physical pixels; `toDip` converts them to Electron's DIP space.
 */
export function winWindowSource(ownPid: number, toDip: (r: Rect) => Rect): WindowSource {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const dwm = koffi.load('dwmapi.dll');

  const RECT = koffi.struct('DS_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  const EnumWindowsProc = koffi.proto('bool __stdcall DS_EnumWindowsProc(void *hwnd, intptr_t lParam)');
  const EnumWindows = user32.func('bool __stdcall EnumWindows(DS_EnumWindowsProc *cb, intptr_t lParam)');
  const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hwnd)');
  const IsIconic = user32.func('bool __stdcall IsIconic(void *hwnd)');
  const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hwnd, int index)');
  const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)');
  const GetClassNameW = user32.func('int __stdcall GetClassNameW(void *hwnd, void *buf, int max)');
  const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void *hwnd, _Out_ DS_RECT *rect)');
  const DwmGetRect = dwm.func('DwmGetWindowAttribute', 'int32_t', ['void *', 'uint32_t', koffi.out(koffi.pointer(RECT)), 'uint32_t']);
  const DwmGetInt = dwm.func('DwmGetWindowAttribute', 'int32_t', ['void *', 'uint32_t', koffi.out(koffi.pointer('int32_t')), 'uint32_t']);

  const GWL_EXSTYLE = -20;
  const WS_EX_TOOLWINDOW = 0x80;
  const WS_EX_NOACTIVATE = 0x08000000;
  const WS_EX_TRANSPARENT = 0x20;
  const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  const DWMWA_CLOAKED = 14;
  const SKIP_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow', 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland']);
  const classBuf = Buffer.alloc(512);

  let collected: ScreenWindow[] = [];
  const cb = koffi.register((hwnd: unknown) => {
    try {
      if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return true;
      const ex = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
      if (ex & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT)) return true;
      const cloaked = [0];
      if (DwmGetInt(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0) return true;
      const pid = [0];
      GetWindowThreadProcessId(hwnd, pid);
      if (pid[0] === ownPid) return true;
      const len = GetClassNameW(hwnd, classBuf, 256);
      if (len > 0 && SKIP_CLASSES.has(classBuf.toString('utf16le', 0, len * 2))) return true;
      const r = {} as { left: number; top: number; right: number; bottom: number };
      if (DwmGetRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) !== 0 && !GetWindowRect(hwnd, r)) return true;
      const w = r.right - r.left;
      const h = r.bottom - r.top;
      if (w < 40 || h < 40) return true;
      const d = toDip({ x: r.left, y: r.top, width: w, height: h });
      collected.push({ id: String(koffi.address(hwnd)), x: d.x, y: d.y, w: d.width, h: d.height });
    } catch {
      /* skip this window */
    }
    return true;
  }, koffi.pointer(EnumWindowsProc));

  return {
    name: 'windows',
    list() {
      collected = [];
      EnumWindows(cb, 0);
      return collected;
    },
    dispose() {
      koffi.unregister(cb);
    },
  };
}
