import type { Ctx2D } from '../types';
import { Effect, dotSprite, target, type EffectContext } from './base';

interface Fly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  turn: number;
  speed: number;
  phase: number;
  freq: number;
  orbitR: number;
  orbitA: number;
  orbitW: number;
  /** Fraction of flies that answer a still pointer. */
  curious: boolean;
  scatter: number;
}

/** How long the pointer must rest before fireflies come to it. */
export const GATHER_AFTER = 0.8;

export class Fireflies extends Effect {
  flies: Fly[] = [];

  constructor(cx: EffectContext) {
    super(cx);
  }

  private want() {
    return target(38, this.cx.density, 8);
  }

  override onDensity() {
    const n = this.want();
    while (this.flies.length > n) this.flies.pop();
  }

  override prewarm() {
    while (this.flies.length < this.want()) this.flies.push(this.spawn());
  }

  private spawn(): Fly {
    const w = this.world;
    const r = this.rng;
    return {
      x: r.range(0, w.width),
      y: r.range(w.height * 0.25, w.height),
      vx: 0,
      vy: 0,
      heading: r.range(0, Math.PI * 2),
      turn: 0,
      speed: r.range(14, 34),
      phase: r.range(0, Math.PI * 2),
      freq: r.range(0.6, 1.6),
      orbitR: r.range(18, 80),
      orbitA: r.range(0, Math.PI * 2),
      orbitW: r.range(0.4, 1.1) * (r.chance(0.5) ? 1 : -1),
      curious: r.chance(0.8),
      scatter: 0,
    };
  }

  /** Fireflies within 100px of the pointer. */
  gatheredCount(): number {
    const p = this.world.pointer;
    if (!p) return 0;
    let n = 0;
    for (const f of this.flies) if (Math.hypot(f.x - p.x, f.y - p.y) < 100) n++;
    return n;
  }

  update(dt: number) {
    const w = this.world;
    const r = this.rng;
    const want = this.want();
    if (this.flies.length < want && r.chance(dt * 4)) this.flies.push(this.spawn());
    const p = w.pointer;
    const resting = !!p && p.stillFor >= GATHER_AFTER;
    const pSpeed = p ? Math.hypot(p.vx, p.vy) : 0;

    for (const f of this.flies) {
      f.scatter = Math.max(0, f.scatter - dt);
      if (p && pSpeed > 260 && Math.hypot(f.x - p.x, f.y - p.y) < 120 && f.scatter <= 0) {
        // startled by a quick pointer
        const a = Math.atan2(f.y - p.y, f.x - p.x);
        f.vx += Math.cos(a) * 160;
        f.vy += Math.sin(a) * 160;
        f.scatter = 1.2;
      }
      if (resting && f.curious && f.scatter <= 0) {
        f.orbitA += f.orbitW * dt;
        const bob = Math.sin(w.time * f.freq * 1.7 + f.phase) * 6;
        const tx = p!.x + Math.cos(f.orbitA) * f.orbitR;
        const ty = p!.y + Math.sin(f.orbitA) * f.orbitR * 0.75 + bob;
        // spring toward the orbit slot, arriving gently
        const ax = (tx - f.x) * 1.6 - f.vx * 1.4;
        const ay = (ty - f.y) * 1.6 - f.vy * 1.4;
        f.vx += ax * dt;
        f.vy += ay * dt;
      } else {
        // wander: smooth random turning
        f.turn += r.range(-3, 3) * dt;
        f.turn *= 1 - Math.min(1, dt * 1.5);
        f.heading += f.turn * dt * 2;
        let tvx = Math.cos(f.heading) * f.speed;
        let tvy = Math.sin(f.heading) * f.speed * 0.7;
        // keep to the screen, prefer the lower part
        const m = 30;
        if (f.x < m) tvx += 25;
        if (f.x > w.width - m) tvx -= 25;
        if (f.y < w.height * 0.15) tvy += 20;
        if (f.y > w.height - m) tvy -= 20;
        f.vx += (tvx - f.vx) * Math.min(1, dt * 1.2);
        f.vy += (tvy - f.vy) * Math.min(1, dt * 1.2);
      }
      const sp = Math.hypot(f.vx, f.vy);
      const max = f.scatter > 0 ? 220 : 140;
      if (sp > max) {
        f.vx *= max / sp;
        f.vy *= max / sp;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.x = Math.min(w.width + 20, Math.max(-20, f.x));
      f.y = Math.min(w.height + 20, Math.max(-20, f.y));
    }
    this.counters.gathered = this.gatheredCount();
  }

  particleCount() {
    return this.flies.length;
  }

  drawFree(ctx: Ctx2D) {
    const w = this.world;
    const glow = dotSprite(this.cx.sprites, 'ff-glow', 16, 'rgba(214,255,120,0.55)', 'rgba(214,255,120,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.flies) {
      const s = Math.sin(w.time * f.freq + f.phase);
      const b = 0.15 + 0.85 * Math.max(0, s) ** 2;
      ctx.globalAlpha = b;
      if (glow) ctx.drawImage(glow as CanvasImageSource, f.x - 16, f.y - 16, 32, 32);
      ctx.fillStyle = '#f4ffb8';
      ctx.beginPath();
      ctx.arc(f.x, f.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
