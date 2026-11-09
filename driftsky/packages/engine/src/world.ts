import type { Rect, WindowRect } from './types';
import { Rng } from './rng';

export type SurfaceKind = 'window' | 'dock' | 'ground';

/**
 * Something weather can land on: a window's top edge, the Dock/taskbar, or the bottom of the
 * screen. Positions are in overlay CSS pixels. `vx`/`vy` is a smoothed velocity (px/s) used to
 * decide when a dragged window flings its snow off.
 */
export class Surface {
  vx = 0;
  vy = 0;
  /** Instantaneous displacement this frame. */
  dx = 0;
  dy = 0;
  /** Width change this frame. */
  dw = 0;
  /** Seconds since this surface last moved. */
  stillFor = 0;
  /** Index in the front-to-back stack (0 = frontmost). */
  z = 0;
  alive = true;
  constructor(
    public readonly id: string,
    public kind: SurfaceKind,
    public rect: Rect,
  ) {}
  get top() {
    return this.rect.y;
  }
  get left() {
    return this.rect.x;
  }
  get right() {
    return this.rect.x + this.rect.w;
  }
  get speed() {
    return Math.hypot(this.vx, this.vy);
  }
}

export interface Pointer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  stillFor: number;
}

export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Windows that sit flush with the screen edges and are smaller than this are ignored. */
const MIN_WINDOW = 40;

export class World {
  width = 0;
  height = 0;
  time = 0;
  readonly rng: Rng;
  /** Front-to-back. Windows first, then dock, then ground. */
  surfaces: Surface[] = [];
  private byId = new Map<string, Surface>();
  pointer: Pointer | null = null;
  private pendingPointer: { x: number; y: number } | null = null;
  private removed: Surface[] = [];
  private floorRect: Rect | null = null;
  private pendingWindows: WindowRect[] = [];

  constructor(seed?: number) {
    this.rng = new Rng(seed);
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
  }

  setWindows(wins: WindowRect[]) {
    this.pendingWindows = wins;
  }

  setFloor(r: Rect | null) {
    this.floorRect = r && r.w > 0 && r.h > 0 ? r : null;
  }

  setPointer(p: { x: number; y: number } | null) {
    this.pendingPointer = p;
    if (!p) this.pointer = null;
  }

  /** Surfaces that disappeared since the last call (closed/minimised windows). */
  drainRemoved(): Surface[] {
    const r = this.removed;
    this.removed = [];
    return r;
  }

  get(id: string) {
    return this.byId.get(id);
  }

  /** Apply the latest window list, compute per-surface motion. */
  sync(dt: number) {
    this.time += dt;
    const seen = new Set<string>();
    const next: Surface[] = [];
    const inv = dt > 0 ? 1 / dt : 0;
    const k = Math.min(1, dt * 18); // velocity smoothing

    const upsert = (id: string, kind: SurfaceKind, r: Rect) => {
      seen.add(id);
      let s = this.byId.get(id);
      if (!s) {
        s = new Surface(id, kind, { ...r });
        this.byId.set(id, s);
      } else {
        s.dx = r.x - s.rect.x;
        s.dy = r.y - s.rect.y;
        s.dw = r.w - s.rect.w;
        const ivx = s.dx * inv;
        const ivy = s.dy * inv;
        s.vx += (ivx - s.vx) * k;
        s.vy += (ivy - s.vy) * k;
        // snap tiny residual velocities to zero so a parked window counts as still
        if (s.dx === 0 && s.dy === 0 && Math.abs(s.vx) < 2 && Math.abs(s.vy) < 2) {
          s.vx = 0;
          s.vy = 0;
        }
        s.rect = { ...r };
      }
      if (s.dx !== 0 || s.dy !== 0 || s.dw !== 0) s.stillFor = 0;
      else s.stillFor += dt;
      s.kind = kind;
      s.z = next.length;
      next.push(s);
    };

    for (const w of this.pendingWindows) {
      if (!(w.w >= MIN_WINDOW && w.h >= MIN_WINDOW)) continue;
      if (![w.x, w.y, w.w, w.h].every(Number.isFinite)) continue;
      // windows entirely off this screen can't hold anything
      if (w.x + w.w < 0 || w.x > this.width || w.y > this.height || w.y + w.h < 0) continue;
      // a window filling the screen has its top edge under the menu bar: nothing lands there
      upsert('w:' + w.id, 'window', w);
    }
    if (this.floorRect) upsert('dock', 'dock', this.floorRect);
    upsert('ground', 'ground', { x: 0, y: this.height, w: this.width, h: 0 });

    for (const [id, s] of this.byId) {
      if (!seen.has(id)) {
        s.alive = false;
        this.byId.delete(id);
        this.removed.push(s);
      }
    }
    this.surfaces = next;

    // pointer
    if (this.pendingPointer) {
      const p = this.pendingPointer;
      if (!this.pointer) this.pointer = { x: p.x, y: p.y, vx: 0, vy: 0, stillFor: 0 };
      else {
        const pdx = p.x - this.pointer.x;
        const pdy = p.y - this.pointer.y;
        this.pointer.vx += (pdx * inv - this.pointer.vx) * k;
        this.pointer.vy += (pdy * inv - this.pointer.vy) * k;
        if (Math.abs(pdx) + Math.abs(pdy) > 0.5) this.pointer.stillFor = 0;
        else {
          this.pointer.stillFor += dt;
          this.pointer.vx *= 0.8;
          this.pointer.vy *= 0.8;
        }
        this.pointer.x = p.x;
        this.pointer.y = p.y;
      }
    }
  }

  /** Is the top edge of `s` at x visible, i.e. not covered by a window in front of it? */
  exposed(s: Surface, x: number, y = s.top): boolean {
    for (let i = 0; i < s.z; i++) {
      const f = this.surfaces[i];
      if (f.kind !== 'window') continue;
      if (x >= f.rect.x && x <= f.rect.x + f.rect.w && y >= f.rect.y - 0.5 && y <= f.rect.y + f.rect.h) return false;
    }
    return true;
  }

  /**
   * If a particle moving from y0 to y1 at x crosses the top edge of an exposed surface, return
   * the frontmost such surface. Ground always catches what reaches the bottom.
   */
  landing(x: number, y0: number, y1: number): Surface | null {
    if (y1 < y0) return null;
    for (const s of this.surfaces) {
      const top = s.top;
      if (y0 <= top + 0.001 && y1 >= top && x >= s.left && x <= s.right) {
        if (s.kind === 'ground' || this.exposed(s, x)) return s;
      }
    }
    return null;
  }

  /** Window (front-most) containing the point, if any. */
  windowAt(x: number, y: number): Surface | null {
    for (const s of this.surfaces) if (s.kind === 'window' && contains(s.rect, x, y)) return s;
    return null;
  }
}
