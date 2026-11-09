import type { Ctx2D } from '../types';
import { Effect, target, type EffectContext } from './base';

interface Drop {
  x: number;
  y: number;
  vy: number;
  len: number;
  depth: number;
}
interface Droplet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}
interface Ripple {
  x: number;
  y: number;
  age: number;
  max: number;
  w: number;
}
interface Bolt {
  pts: Array<[number, number]>;
  branches: Array<Array<[number, number]>>;
  age: number;
}

export class Rain extends Effect {
  drops: Drop[] = [];
  droplets: Droplet[] = [];
  ripples: Ripple[] = [];
  /** Screen flash brightness 0..1. */
  flash = 0;
  bolt: Bolt | null = null;
  /** Seconds until the next lightning strike. */
  nextStrike: number;
  /** Horizontal slant (px/s). */
  wind: number;

  constructor(cx: EffectContext) {
    super(cx);
    this.nextStrike = this.rng.range(8, 22);
    this.wind = this.rng.range(-90, 40);
  }

  private want() {
    return target(260, this.cx.density, 20);
  }

  override onDensity() {
    const n = this.want();
    while (this.drops.length > n) this.drops.pop();
  }

  override prewarm() {
    while (this.drops.length < this.want()) this.drops.push(this.spawn(true));
  }

  private spawn(anywhere: boolean): Drop {
    const w = this.world;
    const depth = this.rng.next();
    return {
      x: this.rng.range(-100, w.width + 100),
      y: anywhere ? this.rng.range(-40, w.height) : this.rng.range(-120, -20),
      vy: 850 + depth * 650,
      len: 9 + depth * 16,
      depth,
    };
  }

  /** Force a lightning strike now (used by tests and the website demo). */
  strike() {
    const w = this.world;
    const pts: Array<[number, number]> = [];
    let x = this.rng.range(w.width * 0.15, w.width * 0.85);
    let y = 0;
    const end = this.rng.range(w.height * 0.35, w.height * 0.7);
    pts.push([x, y]);
    const branches: Array<Array<[number, number]>> = [];
    while (y < end) {
      x += this.rng.range(-26, 26);
      y += this.rng.range(14, 34);
      pts.push([x, y]);
      if (this.rng.chance(0.12)) {
        const b: Array<[number, number]> = [[x, y]];
        let bx = x;
        let by = y;
        const dir = this.rng.chance(0.5) ? -1 : 1;
        for (let k = 0; k < this.rng.int(3, 6); k++) {
          bx += dir * this.rng.range(8, 26);
          by += this.rng.range(10, 24);
          b.push([bx, by]);
        }
        branches.push(b);
      }
    }
    this.bolt = { pts, branches, age: 0 };
    this.flash = 1;
    this.bump('lightning');
  }

  update(dt: number) {
    const w = this.world;
    const want = this.want();
    let budget = Math.max(2, Math.ceil(want * dt * 2));
    while (this.drops.length < want && budget-- > 0) this.drops.push(this.spawn(false));

    this.nextStrike -= dt;
    if (this.nextStrike <= 0) {
      this.strike();
      this.nextStrike = this.rng.range(12, 38);
    }
    // flash decays with a flicker
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);
    if (this.bolt) {
      this.bolt.age += dt;
      if (this.bolt.age > 0.28) this.bolt = null;
    }

    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      const y0 = d.y;
      d.y += d.vy * dt;
      d.x += this.wind * (0.6 + d.depth * 0.4) * dt;
      if (d.depth > 0.4) {
        const s = w.landing(d.x, y0, d.y);
        if (s) {
          this.splash(d.x, s.top, d.depth);
          this.drops[i] = this.spawn(false);
          continue;
        }
      } else if (d.y > w.height * (0.6 + d.depth)) {
        this.drops[i] = this.spawn(false);
        continue;
      }
      if (d.y > w.height + 20) this.drops[i] = this.spawn(false);
    }

    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const p = this.droplets[i];
      p.life -= dt;
      p.vy += 1500 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) this.droplets.splice(i, 1);
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += dt;
      if (r.age >= r.max) this.ripples.splice(i, 1);
    }
  }

  private splash(x: number, y: number, depth: number) {
    this.bump('splashes');
    if (this.droplets.length < 900) {
      const n = this.rng.int(2, 4);
      for (let k = 0; k < n; k++) {
        this.droplets.push({
          x,
          y: y - 1,
          vx: this.rng.range(-110, 110) + this.wind * 0.2,
          vy: -this.rng.range(110, 240) * (0.6 + depth * 0.5),
          life: this.rng.range(0.18, 0.36),
        });
      }
    }
    if (this.ripples.length < 300) this.ripples.push({ x, y, age: 0, max: this.rng.range(0.22, 0.4), w: this.rng.range(5, 10) });
  }

  particleCount() {
    return this.drops.length + this.droplets.length;
  }

  drawFree(ctx: Ctx2D) {
    const w = this.world;
    ctx.save();
    ctx.lineCap = 'round';
    // three depth bands, one stroke each
    const bands: Array<[number, number, number, number]> = [
      [0, 0.4, 0.22, 0.8],
      [0.4, 0.75, 0.38, 1],
      [0.75, 1.01, 0.55, 1.3],
    ];
    const slant = this.wind / 1200;
    for (const [lo, hi, alpha, width] of bands) {
      ctx.beginPath();
      for (const d of this.drops) {
        if (d.depth < lo || d.depth >= hi) continue;
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - slant * d.len, d.y - d.len);
      }
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.strokeStyle = '#c9d8ee';
      ctx.stroke();
    }
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#d8e4f5';
    for (const p of this.droplets) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#d8e4f5';
    ctx.lineWidth = 1;
    for (const r of this.ripples) {
      const t = r.age / r.max;
      ctx.globalAlpha = (1 - t) * 0.6;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 1 + r.w * t, 0.6 + r.w * 0.25 * t, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.bolt) {
      const a = Math.max(0, 1 - this.bolt.age / 0.28);
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#f3f6ff';
      for (const [path, lw] of [[this.bolt.pts, 2.4], ...this.bolt.branches.map((b) => [b, 1.2] as const)] as const) {
        ctx.lineWidth = lw as number;
        ctx.beginPath();
        (path as Array<[number, number]>).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    }
    if (this.flash > 0) {
      // double flicker: bright, dip, bright, fade
      const f = this.flash;
      const flicker = f > 0.75 ? 1 : f > 0.6 ? 0.35 : f;
      ctx.globalAlpha = 0.16 * flicker;
      ctx.fillStyle = '#e8eeff';
      ctx.fillRect(0, 0, w.width, w.height);
    }
    ctx.restore();
  }
}
