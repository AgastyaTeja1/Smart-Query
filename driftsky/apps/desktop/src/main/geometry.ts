import type { WorldFrame } from '../shared/types';
import type { ScreenWindow } from './windowsource/types';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The Dock (Mac) or taskbar (Windows) is the strip at the bottom of the display that isn't part of
 * the work area. Only a bottom Dock/taskbar is a surface; side ones and auto-hidden ones aren't.
 */
export function floorRect(bounds: Box, workArea: Box): WorldFrame['floor'] {
  const bottomGap = bounds.y + bounds.height - (workArea.y + workArea.height);
  if (bottomGap < 8 || bottomGap > bounds.height * 0.3) return null;
  return { x: 0, y: bounds.height - bottomGap, w: bounds.width, h: bottomGap };
}

/** A window that covers the whole display is a full-screen app (game, video, presentation). */
export function isFullScreen(w: ScreenWindow, display: Box) {
  return w.x <= display.x + 1 && w.y <= display.y + 1 && w.x + w.w >= display.x + display.width - 1 && w.y + w.h >= display.y + display.height - 1;
}

/** Windows that touch this display, converted to its local coordinates. */
export function frameFor(
  display: { bounds: Box; workArea: Box },
  windows: ScreenWindow[],
  cursor: { x: number; y: number } | null,
  behindWindows: boolean,
): WorldFrame & { fullscreen: boolean } {
  const b = display.bounds;
  const local: WorldFrame['windows'] = [];
  let fullscreen = false;
  for (const w of windows) {
    if (w.x + w.w <= b.x || w.x >= b.x + b.width || w.y + w.h <= b.y || w.y >= b.y + b.height) continue;
    // only the frontmost window on this display decides whether it's in full screen
    if (local.length === 0 && isFullScreen(w, b)) fullscreen = true;
    local.push({ id: w.id, x: w.x - b.x, y: w.y - b.y, w: w.w, h: w.h });
  }
  const inside = cursor && cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height;
  return {
    // behind the windows, nothing can land on them: only the Dock and the bottom of the screen
    windows: behindWindows ? [] : local,
    floor: floorRect(b, display.workArea),
    pointer: inside ? { x: cursor!.x - b.x, y: cursor!.y - b.y } : null,
    fullscreen,
  };
}
