import type { CanvasLike, Ctx2D, EngineStats } from '../types';
import type { Surface, World } from '../world';

export type SpriteFactory = ((w: number, h: number) => CanvasLike) | undefined;

/** Pre-rendered images keyed by name, so per-particle drawing is one drawImage call. */
export class Sprites {
  private cache = new Map<string, CanvasLike | null>();
  constructor(private factory: SpriteFactory) {}
  get(key: string, w: number, h: number, paint: (ctx: Ctx2D) => void): CanvasLike | null {
    if (this.cache.has(key)) return this.cache.get(key)!;
    let c: CanvasLike | null = null;
    if (this.factory) {
      try {
        c = this.factory(Math.ceil(w), Math.ceil(h));
        const ctx = c.getContext('2d');
        if (ctx) paint(ctx);
        else c = null;
      } catch {
        c = null;
      }
    }
    this.cache.set(key, c);
    return c;
  }
}

export interface EffectContext {
  world: World;
  sprites: Sprites;
  /** Relative particle budget: intensity × screen area × (0.5 on battery). */
  density: number;
}

export abstract class Effect {
  readonly counters: Partial<EngineStats> = {};
  constructor(protected cx: EffectContext) {}
  get world() {
    return this.cx.world;
  }
  get rng() {
    return this.cx.world.rng;
  }
  /** Called when the density changes (intensity/battery/resize). */
  onDensity(): void {}
  abstract update(dt: number): void;
  /** Draw whatever rests on this surface (snow pile, petals…). */
  drawSurface(_ctx: Ctx2D, _s: Surface): void {}
  /** Draw everything that is in the air. */
  abstract drawFree(ctx: Ctx2D): void;
  /** A surface disappeared (window closed/minimised). */
  onRemoved(_s: Surface): void {}
  abstract particleCount(): number;
  piled(): number {
    return 0;
  }
  resting(): number {
    return 0;
  }
  /** Spawn a full screen of particles immediately instead of waiting for them to fall in. */
  prewarm(): void {}
  /**
   * Place what `seconds` of weather would have left on surfaces (snow piles, resting petals and
   * leaves) without simulating it frame by frame. Cheap: proportional to surface width.
   */
  settle(_seconds: number): void {}
  bump(key: keyof EngineStats, n = 1) {
    (this.counters as Record<string, number>)[key] = ((this.counters as Record<string, number>)[key] ?? 0) + n;
  }
}

export function target(base: number, density: number, min = 1) {
  return Math.max(min, Math.round(base * density));
}

/** Soft round dot. */
export function dotSprite(sprites: Sprites, key: string, r: number, inner: string, outer: string) {
  const s = Math.ceil(r * 2);
  return sprites.get(key, s, s, (c) => {
    const g = c.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, inner);
    g.addColorStop(0.55, inner);
    g.addColorStop(1, outer);
    c.fillStyle = g;
    c.beginPath();
    c.arc(r, r, r, 0, Math.PI * 2);
    c.fill();
  });
}

/** How fast something must move (px/s) before what sits on it slides off. */
export const SHED_SPEED = 45;

/** Fraction of resting material to shed this frame for a surface moving at `speed`. */
export function shedFraction(speed: number, dt: number) {
  if (speed <= SHED_SPEED) return 0;
  const rate = (speed - SHED_SPEED) / 55; // per second
  return 1 - Math.exp(-rate * dt);
}
