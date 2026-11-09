import type { ScreenWindow, WindowSource } from './types';

/**
 * macOS: CGWindowListCopyWindowInfo via koffi (no native build step). Returns on-screen windows
 * front-to-back in global points with a top-left origin, the same space as Electron's screen API.
 * Window bounds don't need Screen Recording permission (only titles would, and we never read them).
 */
export function macWindowSource(ownPid: number): WindowSource {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi');
  const CF = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const CG = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');

  const CGRect = koffi.struct('DS_CGRect', { x: 'double', y: 'double', w: 'double', h: 'double' });
  const CGWindowListCopyWindowInfo = CG.func('void *CGWindowListCopyWindowInfo(uint32_t option, uint32_t relativeToWindow)');
  const CGRectMakeWithDictionaryRepresentation = CG.func('bool CGRectMakeWithDictionaryRepresentation(void *dict, _Out_ DS_CGRect *rect)');
  const CFArrayGetCount = CF.func('long CFArrayGetCount(void *arr)');
  const CFArrayGetValueAtIndex = CF.func('void *CFArrayGetValueAtIndex(void *arr, long idx)');
  const CFDictionaryGetValue = CF.func('void *CFDictionaryGetValue(void *dict, void *key)');
  const CFNumberGetValueInt = CF.func('bool CFNumberGetValue(void *num, int type, _Out_ int32_t *out)');
  const CFNumberGetValueDouble = CF.func('bool CFNumberGetValue(void *num, int type, _Out_ double *out)');
  const CFStringCreateWithCString = CF.func('void *CFStringCreateWithCString(void *alloc, const char *s, uint32_t encoding)');
  const CFRelease = CF.func('void CFRelease(void *obj)');

  const UTF8 = 0x08000100;
  const key = (s: string) => CFStringCreateWithCString(null, s, UTF8);
  const K = {
    layer: key('kCGWindowLayer'),
    bounds: key('kCGWindowBounds'),
    pid: key('kCGWindowOwnerPID'),
    number: key('kCGWindowNumber'),
    alpha: key('kCGWindowAlpha'),
  };
  const kCFNumberSInt32Type = 3;
  const kCFNumberDoubleType = 13;
  // on-screen only, skip desktop elements (icons, wallpaper)
  const OPTIONS = 1 | 16;

  const int = (dict: unknown, k: unknown): number | null => {
    const v = CFDictionaryGetValue(dict, k);
    if (!v) return null;
    const out = [0];
    return CFNumberGetValueInt(v, kCFNumberSInt32Type, out) ? out[0] : null;
  };
  const dbl = (dict: unknown, k: unknown): number | null => {
    const v = CFDictionaryGetValue(dict, k);
    if (!v) return null;
    const out = [0];
    return CFNumberGetValueDouble(v, kCFNumberDoubleType, out) ? out[0] : null;
  };

  return {
    name: 'mac',
    list(): ScreenWindow[] {
      const arr = CGWindowListCopyWindowInfo(OPTIONS, 0);
      if (!arr) return [];
      const out: ScreenWindow[] = [];
      try {
        const n = CFArrayGetCount(arr);
        for (let i = 0; i < n; i++) {
          const d = CFArrayGetValueAtIndex(arr, i);
          // layer 0 = ordinary app windows (menu bar, Dock, popups and overlays sit on other layers)
          if (int(d, K.layer) !== 0) continue;
          if (int(d, K.pid) === ownPid) continue;
          const alpha = dbl(d, K.alpha);
          if (alpha !== null && alpha < 0.05) continue;
          const bd = CFDictionaryGetValue(d, K.bounds);
          if (!bd) continue;
          const r = {} as { x: number; y: number; w: number; h: number };
          if (!CGRectMakeWithDictionaryRepresentation(bd, r)) continue;
          out.push({ id: String(int(d, K.number) ?? i), x: r.x, y: r.y, w: r.w, h: r.h });
        }
      } finally {
        CFRelease(arr);
      }
      return out;
    },
  };
}
