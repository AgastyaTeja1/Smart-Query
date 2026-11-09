import type { CanvasLike, Ctx2D } from '../types';
import type { Surface } from '../world';
import { Effect, shedFraction, target, type EffectContext } from './base';

interface Item {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  flip: number;
  vflip: number;
  size: number;
  variant: number;
  depth: number;
  phase: number;
  freq: number;
  /** Surface it can't land on for a moment (just left it). */
  from: string | null;
  grace: number;
}

interface Resting {
  sid: string;
  lx: number;
  /** Height above the surface's top edge (stacking). */
  ly: number;
  rot: number;
  flip: number;
  size: number;
  variant: number;
  age: number;
  life: number;
  order: number;
}

export interface TumbleConfig {
  base: number;
  min: number;
  /** Terminal fall speed range (px/s). */
  fall: [number, number];
  sway: [number, number];
  size: [number, number];
  restLife: [number, number];
  /** Max resting items per 100px of surface. */
  restPer100: number;
  /** Leaves stack on each other; petals lie flat. */
  stack: boolean;
  /** The pointer can sweep resting items away. */
  brush: boolean;
  variants: number;
  paint: (ctx: Ctx2D, variant: number, s: number) => void;
}

const BUCKET = 9;
const FADE = 2.5;

export class Tumble extends Effect {
  items: Item[] = [];
  rest: Resting[] = [];
  private orderSeq = 0;
  private wind = 0;
  private windTarget = 0;
  private windTimer = 0;

  constructor(
    cx: EffectContext,
    readonly cfg: TumbleConfig,
    private readonly key: string,
  ) {
    super(cx);
  }

  private want() {
    return target(this.cfg.base, this.cx.density, this.cfg.min);
  }

  override onDensity() {
    const n = this.want();
    while (this.items.length > n) this.items.pop();
  }

  override settle(seconds: number) {
    const w = this.world;
    if (seconds <= 0 || w.width < 2) return;
    this.prewarm();
    let vySum = 0;
    for (const it of this.items) if (it.depth > 0.3) vySum += (this.cfg.fall[0] + this.cfg.fall[1]) / 2;
    const flux = vySum / (w.width + 140) / (w.height + 60);
    for (const s of w.surfaces) {
      const cap = this.restCap(s);
      const want = Math.min(cap, Math.round(flux * Math.min(seconds, this.cfg.restLife[1]) * s.rect.w));
      let placed = this.rest.filter((r) => r.sid === s.id).length;
      for (let tries = 0; placed < want && tries < want * 4; tries++) {
        const x = s.left + this.rng.range(4, s.rect.w - 4);
        if (s.kind !== 'ground' && !w.exposed(s, x)) continue;
        const life = this.rng.range(...this.cfg.restLife);
        this.rest.push({
          sid: s.id,
          lx: x - s.left,
          ly: 0,
          rot: this.rng.range(0, Math.PI * 2),
          flip: this.rng.range(0.4, 1),
          size: this.rng.range(...this.cfg.size) * this.rng.range(0.75, 1.1),
          variant: this.rng.int(0, this.cfg.variants - 1),
          age: this.rng.range(0, Math.min(seconds, life * 0.7)),
          life,
          order: this.orderSeq++,
        });
        placed++;
      }
    }
    if (this.cfg.stack) this.restack();
  }

  override prewarm() {
    while (this.items.length < this.want()) this.items.push(this.spawn(true));
  }

  private spawn(anywhere: boolean): Item {
    const w = this.world;
    const r = this.rng;
    const depth = r.next();
    return {
      x: r.range(-60, w.width + 60),
      y: anywhere ? r.range(-30, w.height) : r.range(-80, -15),
      vx: 0,
      vy: r.range(...this.cfg.fall) * 0.5,
      rot: r.range(0, Math.PI * 2),
      vrot: r.range(-2.2, 2.2),
      flip: r.range(0, Math.PI * 2),
      vflip: r.range(1.5, 4.5),
      size: r.range(...this.cfg.size) * (0.6 + depth * 0.5),
      variant: r.int(0, this.cfg.variants - 1),
      depth,
      phase: r.range(0, Math.PI * 2),
      freq: r.range(0.5, 1.3),
      from: null,
      grace: 0,
    };
  }

  private restCap(s: Surface) {
    return Math.max(3, Math.floor((s.rect.w / 100) * this.cfg.restPer100));
  }

  update(dt: number) {
    const w = this.world;
    const r = this.rng;
    this.windTimer -= dt;
    if (this.windTimer <= 0) {
      this.windTimer = r.range(5, 12);
      this.windTarget = r.range(-30, 30);
    }
    this.wind += (this.windTarget - this.wind) * Math.min(1, dt * 0.5);

    const want = this.want();
    let budget = Math.max(1, Math.ceil(want * dt * 0.4));
    while (this.items.length < want && budget-- > 0) this.items.push(this.spawn(false));

    // surfaces: resting things slide off moving / resized windows
    const counts = new Map<string, number>();
    const p = w.pointer;
    const pSpeed = p ? Math.hypot(p.vx, p.vy) : 0;
    for (let i = this.rest.length - 1; i >= 0; i--) {
      const it = this.rest[i];
      const s = w.get(it.sid);
      if (!s) continue; // handled by onRemoved
      it.age += dt;
      if (it.age >= it.life) {
        this.rest.splice(i, 1);
        continue;
      }
      const wx = s.left + it.lx;
      const wy = s.top - it.ly;
      let fly = it.lx > s.rect.w + 2 || (s.kind === 'window' && r.chance(shedFraction(s.speed, dt)));
      let vx = s.vx * 0.8;
      let vy = Math.min(0, s.vy * 0.5) - r.range(20, 80);
      // brushing past with the pointer
      if (!fly && this.cfg.brush && p && pSpeed > 110) {
        const d = Math.hypot(p.x - wx, p.y - wy);
        if (d < 48) {
          fly = true;
          vx = p.vx * 0.55 + r.range(-40, 40);
          vy = -r.range(140, 320) + Math.min(0, p.vy * 0.3);
          this.bump('shed');
        }
      }
      if (fly) {
        this.rest.splice(i, 1);
        this.launch(wx, wy - 1, vx, vy, it, s.id);
        continue;
      }
      counts.set(it.sid, (counts.get(it.sid) ?? 0) + 1);
    }
    if (this.cfg.stack) this.restack();

    const recycle = (i: number) => {
      if (this.items.length > want) this.items.splice(i, 1);
      else this.items[i] = this.spawn(false);
    };
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const y0 = it.y;
      const term = this.cfg.fall[0] + (this.cfg.fall[1] - this.cfg.fall[0]) * it.depth;
      const swayAmp = this.cfg.sway[0] + (this.cfg.sway[1] - this.cfg.sway[0]) * it.depth;
      const targetVx = this.wind + Math.sin(w.time * it.freq + it.phase) * swayAmp;
      it.vy += (term - it.vy) * Math.min(1, 1.8 * dt) + (it.vy < term ? 120 * dt : 0);
      it.vx += (targetVx - it.vx) * Math.min(1, 1.4 * dt);
      // the pointer stirs leaves in the air too
      if (this.cfg.brush && p && pSpeed > 150) {
        const dx = it.x - p.x;
        const dy = it.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 70 * 70) {
          it.vx += p.vx * 2.2 * dt;
          it.vy += p.vy * 1.2 * dt - 60 * dt;
        }
      }
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.rot += it.vrot * dt;
      it.flip += it.vflip * dt;
      it.grace -= dt;
      if (it.x < -80) it.x += w.width + 140;
      else if (it.x > w.width + 80) it.x -= w.width + 140;

      if (it.depth > 0.3 && it.vy > 0) {
        const s = w.landing(it.x, y0, it.y);
        if (s && !(s.id === it.from && it.grace > 0)) {
          const n = counts.get(s.id) ?? 0;
          if (n < this.restCap(s)) {
            this.rest.push({
              sid: s.id,
              lx: it.x - s.left,
              ly: 0,
              rot: it.rot,
              flip: Math.max(0.35, Math.abs(Math.cos(it.flip))),
              size: it.size,
              variant: it.variant,
              age: 0,
              life: r.range(...this.cfg.restLife),
              order: this.orderSeq++,
            });
            counts.set(s.id, n + 1);
            this.bump('landed');
            recycle(i);
            if (this.cfg.stack) this.restack();
            continue;
          }
        }
      }
      if (it.y > w.height + 30) recycle(i);
    }
  }

  /** Stack resting items in BUCKET-wide columns, oldest at the bottom. */
  private restack() {
    const cols = new Map<string, Map<number, number>>();
    const sorted = [...this.rest].sort((a, b) => a.order - b.order);
    for (const it of sorted) {
      let m = cols.get(it.sid);
      if (!m) cols.set(it.sid, (m = new Map()));
      const b = Math.floor(it.lx / BUCKET);
      const h = m.get(b) ?? 0;
      it.ly = Math.min(h, 16);
      m.set(b, h + it.size * 0.22);
    }
  }

  private launch(x: number, y: number, vx: number, vy: number, from: Pick<Item, 'rot' | 'size' | 'variant'>, sid: string) {
    const it = this.spawn(false);
    Object.assign(it, { x, y, vx, vy, rot: from.rot, size: from.size, variant: from.variant, depth: Math.max(it.depth, 0.5), from: sid, grace: 0.5 });
    // keep the population bounded: replace a not-yet-visible item if we're full
    const idx = this.items.findIndex((o) => o.y < -10);
    if (this.items.length >= this.want() + 60 && idx >= 0) this.items[idx] = it;
    else this.items.push(it);
  }

  override onRemoved(s: Surface) {
    for (let i = this.rest.length - 1; i >= 0; i--) {
      const it = this.rest[i];
      if (it.sid !== s.id) continue;
      this.rest.splice(i, 1);
      if (s.kind === 'window') this.launch(s.left + it.lx, s.top - it.ly, this.rng.range(-30, 30), 20, it, s.id);
    }
  }

  particleCount() {
    return this.items.length;
  }

  override resting() {
    return this.rest.length;
  }

  private sprite(variant: number): CanvasLike | null {
    const S = 32;
    return this.cx.sprites.get(`${this.key}:${variant}`, S, S, (c) => {
      c.translate(S / 2, S / 2);
      this.cfg.paint(c, variant, S * 0.42);
    });
  }

  private drawOne(ctx: Ctx2D, x: number, y: number, rot: number, flipScale: number, size: number, variant: number, alpha: number) {
    const sp = this.sprite(variant);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(Math.max(0.12, flipScale), 1);
    if (sp) ctx.drawImage(sp as CanvasImageSource, -size / 2, -size / 2, size, size);
    else this.cfg.paint(ctx, variant, size * 0.42);
    ctx.restore();
  }

  override drawSurface(ctx: Ctx2D, s: Surface) {
    for (const it of this.rest) {
      if (it.sid !== s.id) continue;
      const left = it.life - it.age;
      const a = left < FADE ? left / FADE : Math.min(1, it.age * 4);
      // lie mostly flat: squash vertically
      this.drawOne(ctx, s.left + it.lx, s.top - it.ly - it.size * 0.18, it.rot * 0.25, it.flip, it.size, it.variant, a);
    }
  }

  drawFree(ctx: Ctx2D) {
    for (const it of this.items) this.drawOne(ctx, it.x, it.y, it.rot, Math.cos(it.flip), it.size, it.variant, 0.55 + it.depth * 0.45);
  }
}

const PETAL_COLORS = [
  ['#ffd3e2', '#f59ab9'],
  ['#ffe4ee', '#f7b2c9'],
  ['#fbc2d6', '#ea7fa4'],
];

export function sakuraConfig(): TumbleConfig {
  return {
    base: 75,
    min: 8,
    fall: [32, 62],
    sway: [14, 42],
    size: [13, 21],
    restLife: [22, 45],
    restPer100: 2.2,
    stack: false,
    brush: false,
    variants: PETAL_COLORS.length,
    paint(c, v, s) {
      const [light, deep] = PETAL_COLORS[v % PETAL_COLORS.length];
      const g = c.createLinearGradient(0, -s, 0, s);
      g.addColorStop(0, light);
      g.addColorStop(1, deep);
      c.fillStyle = g;
      c.beginPath();
      // petal with a small notch at the tip
      c.moveTo(0, -s * 0.72);
      c.quadraticCurveTo(s * 0.18, -s, s * 0.42, -s * 0.92);
      c.quadraticCurveTo(s * 0.95, -s * 0.35, s * 0.55, s * 0.45);
      c.quadraticCurveTo(s * 0.25, s, 0, s);
      c.quadraticCurveTo(-s * 0.25, s, -s * 0.55, s * 0.45);
      c.quadraticCurveTo(-s * 0.95, -s * 0.35, -s * 0.42, -s * 0.92);
      c.quadraticCurveTo(-s * 0.18, -s, 0, -s * 0.72);
      c.closePath();
      c.fill();
    },
  };
}

const LEAF_COLORS = ['#d9541e', '#e8862a', '#c23b22', '#f2b134', '#9a4d2b', '#e06b2c'];

export function leavesConfig(): TumbleConfig {
  return {
    base: 55,
    min: 6,
    fall: [48, 92],
    sway: [22, 60],
    size: [14, 24],
    restLife: [45, 110],
    restPer100: 4,
    stack: true,
    brush: true,
    variants: LEAF_COLORS.length * 2,
    paint(c, v, s) {
      const color = LEAF_COLORS[v % LEAF_COLORS.length];
      const maple = v >= LEAF_COLORS.length;
      c.fillStyle = color;
      c.beginPath();
      if (maple) {
        // five-lobed leaf
        const pts = 10;
        for (let i = 0; i <= pts; i++) {
          const a = -Math.PI / 2 + (i / pts) * Math.PI * 2;
          const rr = i % 2 === 0 ? s : s * 0.48;
          const x = Math.cos(a) * rr;
          const y = Math.sin(a) * rr * 0.95;
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
      } else {
        c.moveTo(0, -s);
        c.quadraticCurveTo(s * 0.75, -s * 0.2, 0, s * 0.85);
        c.quadraticCurveTo(-s * 0.75, -s * 0.2, 0, -s);
      }
      c.closePath();
      c.fill();
      // vein + stem
      c.strokeStyle = 'rgba(80,30,10,0.45)';
      c.lineWidth = Math.max(0.6, s * 0.07);
      c.beginPath();
      c.moveTo(0, -s * 0.8);
      c.lineTo(0, s);
      c.stroke();
    },
  };
}
