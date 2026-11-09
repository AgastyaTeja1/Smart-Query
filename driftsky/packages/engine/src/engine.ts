import type { Ctx2D, EffectId, EngineOptions, EngineStats, Rect, WindowRect } from './types';
import { World } from './world';
import { Effect, Sprites, type EffectContext } from './effects/base';
import { Snow } from './effects/snow';
import { Rain } from './effects/rain';
import { Tumble, leavesConfig, sakuraConfig } from './effects/tumble';
import { Fireflies } from './effects/fireflies';
import { Starfall } from './effects/starfall';

/** Reference screen the base particle counts are tuned for. */
const REF_AREA = 1440 * 900;
/** Largest step we simulate at once; longer gaps (sleep, tab hidden) are skipped, not replayed. */
const MAX_DT = 1 / 20;

export class WeatherEngine {
  readonly world: World;
  private sprites: Sprites;
  private effect: Effect | null = null;
  private effectId: EffectId | 'off' = 'off';
  private intensity: number;
  private lowPower: boolean;
  private ctxRef: EffectContext;
  private fps = 60;

  constructor(opts: EngineOptions) {
    this.world = new World(opts.seed);
    this.sprites = new Sprites(opts.createCanvas);
    this.intensity = clampIntensity(opts.intensity ?? 1);
    this.lowPower = !!opts.lowPower;
    this.ctxRef = { world: this.world, sprites: this.sprites, density: 1 };
    this.setEffect(opts.effect);
  }

  get currentEffect() {
    return this.effectId;
  }

  /** The live effect instance (exposed for tests and debugging). */
  get active(): Effect | null {
    return this.effect;
  }

  resize(w: number, h: number) {
    this.world.resize(w, h);
    this.updateDensity();
  }

  /** Windows in overlay coordinates, front-to-back. */
  setWindows(wins: WindowRect[]) {
    this.world.setWindows(wins);
  }

  /** The Dock / taskbar, if visible on this screen. */
  setFloor(r: Rect | null) {
    this.world.setFloor(r);
  }

  setPointer(p: { x: number; y: number } | null) {
    this.world.setPointer(p);
  }

  setIntensity(v: number) {
    this.intensity = clampIntensity(v);
    this.updateDensity();
  }

  setLowPower(v: boolean) {
    this.lowPower = v;
    this.updateDensity();
  }

  get isLowPower() {
    return this.lowPower;
  }

  setEffect(id: EffectId | 'off', opts: { prewarm?: boolean } = {}) {
    if (id === this.effectId && this.effect) return;
    this.effectId = id;
    this.updateDensity();
    this.effect = makeEffect(id, this.ctxRef);
    if (this.effect && opts.prewarm && this.world.width > 1) this.effect.prewarm();
  }

  private updateDensity() {
    const area = this.world.width * this.world.height;
    const areaFactor = area > 1 ? Math.max(0.15, Math.min(3, area / REF_AREA)) : 1;
    this.ctxRef.density = this.intensity * areaFactor * (this.lowPower ? 0.5 : 1);
    this.effect?.onDensity();
  }

  update(dt: number) {
    if (!(dt > 0)) return;
    if (dt > 0.5) dt = MAX_DT; // woke from sleep: don't fast-forward
    dt = Math.min(dt, MAX_DT);
    this.fps += (1 / dt - this.fps) * 0.05;
    this.world.sync(dt);
    for (const s of this.world.drainRemoved()) this.effect?.onRemoved(s);
    this.effect?.update(dt);
  }

  /**
   * Draw a frame. Resting snow/petals are drawn surface by surface, back to front; before drawing
   * a window's own pile we clear the window's rectangle so anything resting on windows *behind* it
   * is hidden, exactly as the window would hide it. The Dock is drawn last (it sits above windows).
   */
  draw(ctx: Ctx2D) {
    const w = this.world;
    ctx.clearRect(0, 0, w.width, w.height);
    const fx = this.effect;
    if (!fx) return;
    const s = w.surfaces;
    const ground = s.find((x) => x.kind === 'ground');
    const dock = s.find((x) => x.kind === 'dock');
    if (ground) fx.drawSurface(ctx, ground);
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].kind !== 'window') continue;
      const r = s[i].rect;
      ctx.clearRect(r.x, r.y, r.w, r.h);
      fx.drawSurface(ctx, s[i]);
    }
    if (dock) fx.drawSurface(ctx, dock);
    fx.drawFree(ctx);
  }

  /**
   * Fast-forward the *settled* state: apply the current windows, then place what `seconds` of
   * weather would have piled up, and fill the air with particles. Used so demos start mid-storm.
   */
  settle(seconds: number) {
    this.world.sync(1 / 60);
    for (const s of this.world.drainRemoved()) this.effect?.onRemoved(s);
    if (!this.effect) return;
    this.effect.prewarm();
    this.effect.settle(Math.max(0, Math.min(600, seconds || 0)));
  }

  clear() {
    const id = this.effectId;
    this.effectId = 'off';
    this.effect = null;
    this.setEffect(id);
  }

  stats(): EngineStats {
    const fx = this.effect;
    const c = (fx?.counters ?? {}) as Partial<EngineStats>;
    return {
      effect: this.effectId,
      particles: fx?.particleCount() ?? 0,
      piled: Math.round(fx?.piled() ?? 0),
      resting: fx?.resting() ?? 0,
      landed: c.landed ?? 0,
      shed: c.shed ?? 0,
      splashes: c.splashes ?? 0,
      bursts: c.bursts ?? 0,
      lightning: c.lightning ?? 0,
      gathered: c.gathered ?? 0,
      surfaces: this.world.surfaces.length,
      fps: Math.round(this.fps),
    };
  }
}

function clampIntensity(v: number) {
  return Number.isFinite(v) ? Math.min(2, Math.max(0.25, v)) : 1;
}

function makeEffect(id: EffectId | 'off', cx: EffectContext): Effect | null {
  switch (id) {
    case 'snow':
      return new Snow(cx);
    case 'rain':
      return new Rain(cx);
    case 'sakura':
      return new Tumble(cx, sakuraConfig(), 'sakura');
    case 'leaves':
      return new Tumble(cx, leavesConfig(), 'leaves');
    case 'fireflies':
      return new Fireflies(cx);
    case 'starfall':
      return new Starfall(cx);
    default:
      return null;
  }
}
