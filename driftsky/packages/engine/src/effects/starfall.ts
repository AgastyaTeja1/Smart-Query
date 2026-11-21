import type { Ctx2D } from '../types';
import { Effect, type EffectContext } from './base';

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tail: number;
  life: number;
  hue: number;
  width: number;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  hue: number;
}
interface Ring {
  x: number;
  y: number;
  age: number;
}

const HUES = [205, 190, 48, 280, 330];

export class Starfall extends Effect {
  meteors: Meteor[] = [];
  sparks: Spark[] = [];
  rings: Ring[] = [];
  private timer = 0.4;
  /** All meteors in a session share a direction (+1 = left→right). */
  private dir: number;

  constructor(cx: EffectContext) {
    super(cx);
    this.dir = this.rng.chance(0.5) ? 1 : -1;
  }

  /** Spawn one meteor now. Optional overrides make tests deterministic. */
  launch(at?: { x: number; y: number; vx: number; vy: number }) {
    const w = this.world;
    const r = this.rng;
    // scale to the screen so meteors cross it in about a second, whatever its size
    const diag = Math.hypot(w.width, w.height);
    const speed = r.range(0.45, 0.75) * Math.max(500, diag);
    // radians below horizontal; tall screens get steeper meteors so they cross the screen, not beside it
    const minAngle = Math.min(1.3, Math.max(0.45, Math.atan(w.height / (1.4 * w.width))));
    const angle = r.range(minAngle, Math.min(1.45, Math.max(0.9, minAngle + 0.3)));
    const vx = Math.cos(angle) * speed * this.dir;
    const vy = Math.sin(angle) * speed;
    const y0 = r.range(-40, -10);
    // aim for a point along the bottom edge, so the streak crosses the visible screen
    const xLand = r.range(0.05, 1.05) * w.width;
    const tLand = (w.height - y0) / vy;
    const m: Meteor = at
      ? { ...at, tail: 160, life: 3, hue: 205, width: 2 }
      : {
          x: xLand - vx * tLand,
          y: y0,
          vx,
          vy,
          tail: r.range(0.08, 0.16) * Math.max(800, diag),
          // most reach a window or the ground; some burn out on the way
          life: r.chance(0.2) ? r.range(0.3, 0.9) * tLand : tLand + 0.5,
          hue: r.pick(HUES),
          width: r.range(1.4, 2.6),
        };
    this.meteors.push(m);
  }

  update(dt: number) {
    const w = this.world;
    const r = this.rng;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.launch();
      if (r.chance(0.18)) this.launch(); // the occasional pair
      // sqrt: small screens still get a lively sky, big ones don't get a meteor storm
      this.timer = r.range(0.22, 0.85) / Math.max(0.45, Math.sqrt(this.cx.density));
    }
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      const y0 = m.y;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.life -= dt;
      const s = w.landing(m.x, y0, m.y);
      if (s) {
        this.burst(m.x, s.top, m.hue, s.kind === 'ground' ? 0.6 : 1);
        this.meteors.splice(i, 1);
        continue;
      }
      if (m.life <= 0) {
        // burns out in the air with a little fizzle
        this.burst(m.x, m.y, m.hue, 0.25);
        this.meteors.splice(i, 1);
        continue;
      }
      if (m.y > w.height + 50 || m.x < -w.width * 2 || m.x > w.width * 3) this.meteors.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.life -= dt;
      p.vy += 520 * dt;
      p.vx *= 1 - Math.min(1, 1.2 * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) this.sparks.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].age += dt;
      if (this.rings[i].age > 0.45) this.rings.splice(i, 1);
    }
  }

  private burst(x: number, y: number, hue: number, scale: number) {
    this.bump('bursts');
    const n = Math.round(this.rng.range(14, 26) * scale);
    for (let k = 0; k < n && this.sparks.length < 1200; k++) {
      const a = this.rng.range(Math.PI * 1.05, Math.PI * 1.95); // upward fan
      const sp = this.rng.range(80, 300) * (0.6 + scale * 0.4);
      const life = this.rng.range(0.45, 1.1);
      this.sparks.push({ x, y: y - 1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, hue: this.rng.chance(0.3) ? 48 : hue });
    }
    if (scale >= 0.6) this.rings.push({ x, y, age: 0 });
  }

  particleCount() {
    return this.meteors.length + this.sparks.length;
  }

  drawFree(ctx: Ctx2D) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const m of this.meteors) {
      const sp = Math.hypot(m.vx, m.vy) || 1;
      const tx = m.x - (m.vx / sp) * m.tail;
      const ty = m.y - (m.vy / sp) * m.tail;
      const g = ctx.createLinearGradient(tx, ty, m.x, m.y);
      g.addColorStop(0, `hsla(${m.hue},90%,75%,0)`);
      g.addColorStop(0.8, `hsla(${m.hue},95%,82%,0.55)`);
      g.addColorStop(1, 'rgba(255,255,255,0.95)');
      ctx.strokeStyle = g;
      ctx.lineWidth = m.width;
      ctx.globalAlpha = Math.min(1, m.life * 2);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.width * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of this.sparks) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = `hsl(${p.hue},95%,78%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    for (const r of this.rings) {
      const t = r.age / 0.45;
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 4 + t * 22, 1.5 + t * 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
