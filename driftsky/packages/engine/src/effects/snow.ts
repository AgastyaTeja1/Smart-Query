import type { Ctx2D } from '../types';
import { CELL, Pile } from '../pile';
import type { Surface } from '../world';
import { Effect, dotSprite, shedFraction, target, type EffectContext } from './base';

interface Flake {
  x: number;
  y: number;
  vy: number;
  r: number;
  phase: number;
  sway: number;
  freq: number;
  /** 0 = far away (small, faint, never lands) … 1 = close. */
  depth: number;
}

interface Clump {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vol: number;
  /** Clumps from a shed pile can't land on the surface that shed them for a moment. */
  from: string | null;
  grace: number;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
}

const MAX_H = { window: 13, dock: 16, ground: 22 } as const;
/** How much a landed flake adds to the pile; tuned so a window frosts over in ~1–2 minutes. */
const GAIN = 1.5;
const MAX_CLUMPS = 1600;

export class Snow extends Effect {
  flakes: Flake[] = [];
  clumps: Clump[] = [];
  puffs: Puff[] = [];
  piles = new Map<string, Pile>();
  wind = 0;
  private windTarget = 0;
  private windTimer = 0;

  constructor(cx: EffectContext) {
    super(cx);
    this.onDensity();
  }

  private want() {
    return target(230, this.cx.density, 12);
  }

  override onDensity() {
    const n = this.want();
    while (this.flakes.length > n) this.flakes.pop();
  }

  override settle(seconds: number) {
    const w = this.world;
    if (seconds <= 0 || w.width < 2) return;
    this.prewarm();
    // landing flux of the current flake population: landers per px of width per second
    let vySum = 0;
    let r2Sum = 0;
    let n = 0;
    for (const f of this.flakes) {
      if (f.depth <= 0.35) continue;
      vySum += f.vy;
      r2Sum += f.r * f.r;
      n++;
    }
    if (!n) return;
    const flux = vySum / (w.width + 100) / (w.height + 30);
    const meanAmount = ((Math.PI * (r2Sum / n)) / CELL) * GAIN * 1.8;
    for (const s of w.surfaces) {
      const p = this.pile(s);
      const landings = Math.round(flux * seconds * s.rect.w);
      for (let i = 0; i < landings; i++) {
        const x = s.left + this.rng.range(0, s.rect.w);
        if (s.kind !== 'ground' && !w.exposed(s, x)) continue;
        p.add(x - s.left, meanAmount * this.rng.range(0.5, 1.5));
      }
      if (s.kind === 'ground') p.melt(0.08 * seconds * 0.5);
    }
  }

  override prewarm() {
    const n = this.want();
    while (this.flakes.length < n) this.flakes.push(this.spawn(true));
  }

  private spawn(anywhere: boolean): Flake {
    const w = this.world;
    const depth = this.rng.next();
    const r = 0.7 + depth * depth * 2.6 + this.rng.range(0, 0.4);
    return {
      x: this.rng.range(-40, w.width + 40),
      y: anywhere ? this.rng.range(-20, w.height) : this.rng.range(-60, -6),
      vy: 14 + r * 13 + this.rng.range(0, 10),
      r,
      phase: this.rng.range(0, Math.PI * 2),
      sway: this.rng.range(6, 22) * (0.5 + depth),
      freq: this.rng.range(0.6, 1.6),
      depth,
    };
  }

  pile(s: Surface): Pile {
    let p = this.piles.get(s.id);
    if (!p) {
      p = new Pile(s.rect.w, MAX_H[s.kind]);
      this.piles.set(s.id, p);
    }
    return p;
  }

  update(dt: number) {
    const w = this.world;
    // gentle, slowly changing wind
    this.windTimer -= dt;
    if (this.windTimer <= 0) {
      this.windTimer = this.rng.range(6, 14);
      this.windTarget = this.rng.range(-14, 14);
    }
    this.wind += (this.windTarget - this.wind) * Math.min(1, dt * 0.4);

    // top up flakes gradually (no sudden curtain)
    const want = this.want();
    let spawnBudget = Math.max(1, Math.ceil(want * dt * 0.6));
    while (this.flakes.length < want && spawnBudget-- > 0) this.flakes.push(this.spawn(false));

    for (const s of w.surfaces) this.updateSurface(s, dt);

    // falling flakes
    for (let i = 0; i < this.flakes.length; i++) {
      const f = this.flakes[i];
      const y0 = f.y;
      f.y += f.vy * dt;
      f.x += (this.wind * (0.4 + f.depth) + Math.sin(w.time * f.freq + f.phase) * f.sway) * dt;
      if (f.x < -60) f.x += w.width + 100;
      else if (f.x > w.width + 60) f.x -= w.width + 100;
      if (f.depth > 0.35) {
        const s = w.landing(f.x, y0, f.y);
        if (s) {
          const p = this.pile(s);
          p.add(f.x - s.left, ((Math.PI * f.r * f.r) / CELL) * GAIN * 1.8);
          this.bump('landed');
          this.flakes[i] = this.spawn(false);
          continue;
        }
      } else if (f.y > w.height * (0.75 + f.depth * 0.4)) {
        // far flakes fade out before the ground
        this.flakes[i] = this.spawn(false);
        continue;
      }
      if (f.y > w.height + 10) this.flakes[i] = this.spawn(false);
    }

    // clumps thrown off moving windows
    for (let i = this.clumps.length - 1; i >= 0; i--) {
      const c = this.clumps[i];
      const y0 = c.y;
      c.vy += 1150 * dt;
      c.vx *= 1 - Math.min(1, 1.6 * dt);
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.grace -= dt;
      const s = c.vy > 0 ? w.landing(c.x, y0, c.y) : null;
      if (s && !(s.id === c.from && c.grace > 0)) {
        // it breaks up on impact: some settles, some puffs
        this.pile(s).add(c.x - s.left, (c.vol / CELL) * 0.55);
        if (this.rng.chance(0.5)) this.puff(c.x, s.top, c.vx * 0.2, -40);
        this.clumps.splice(i, 1);
        continue;
      }
      if (c.y > w.height + 20 || c.x < -100 || c.x > w.width + 100) this.clumps.splice(i, 1);
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      p.vy += 160 * dt;
      p.vx *= 1 - Math.min(1, 3 * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) this.puffs.splice(i, 1);
    }
  }

  private updateSurface(s: Surface, dt: number) {
    const p = this.piles.get(s.id);
    if (!p) return;
    if (s.kind === 'ground') {
      if (p.width !== Math.ceil(s.rect.w / CELL) * CELL) this.piles.set(s.id, rebuild(p, s.rect.w));
      p.melt(0.08 * dt);
      return;
    }
    if (s.kind === 'dock') {
      if (p.width !== Math.ceil(s.rect.w / CELL) * CELL) this.piles.set(s.id, rebuild(p, s.rect.w));
      p.melt(0.02 * dt);
      return;
    }
    // resized: what's past the new edge falls
    if (s.dw !== 0) {
      for (const [lx, h] of p.resize(s.rect.w)) this.throwChunk(s, lx, h, 0, 0);
    }
    // dragged: snow slides / flies off depending on speed
    const f = shedFraction(s.speed, dt);
    if (f > 0) {
      const chunks = p.shed(f);
      // group neighbouring cells into clumps so a fling makes chunky snow, not dust
      let acc = 0;
      let ax = 0;
      let n = 0;
      for (const [lx, h] of chunks) {
        acc += h;
        ax += lx;
        n++;
        if (n >= 3) {
          this.throwChunk(s, ax / n, acc, s.vx, s.vy);
          acc = ax = n = 0;
        }
      }
      if (n) this.throwChunk(s, ax / n, acc, s.vx, s.vy);
    }
  }

  private throwChunk(s: Surface, lx: number, h: number, vx: number, vy: number) {
    if (h < 0.08) return;
    const vol = h * CELL;
    const x = s.left + lx;
    const y = s.top - Math.min(h, 6);
    if (this.clumps.length < MAX_CLUMPS) {
      this.clumps.push({
        x,
        y,
        vx: vx * 0.75 + this.rng.range(-35, 35),
        vy: Math.min(vy * 0.5, 0) - this.rng.range(10, 90),
        r: Math.max(1.1, Math.min(4.2, Math.sqrt(vol / Math.PI) * 0.9)),
        vol,
        from: s.id,
        grace: 0.35,
      });
    }
    if (this.rng.chance(0.25)) this.puff(x, y, vx * 0.3, -30);
    this.bump('shed');
  }

  private puff(x: number, y: number, vx: number, vy: number) {
    if (this.puffs.length > 400) return;
    const life = this.rng.range(0.3, 0.7);
    this.puffs.push({ x, y, vx: vx + this.rng.range(-30, 30), vy: vy + this.rng.range(-30, 10), life, max: life, r: this.rng.range(0.6, 1.4) });
  }

  override onRemoved(s: Surface) {
    const p = this.piles.get(s.id);
    if (!p) return;
    this.piles.delete(s.id);
    if (s.kind !== 'window') return;
    for (const [lx, h] of p.shed(1)) this.throwChunk(s, lx, h, 0, 60);
  }

  particleCount() {
    return this.flakes.length + this.clumps.length + this.puffs.length;
  }

  override piled() {
    let v = 0;
    for (const p of this.piles.values()) v += p.volume();
    return v;
  }

  override drawSurface(ctx: Ctx2D, s: Surface) {
    const p = this.piles.get(s.id);
    if (!p) return;
    const h = p.heights;
    let max = 0;
    for (let i = 0; i < h.length; i++) if (h[i] > max) max = h[i];
    if (max < 0.15) return;
    const left = s.left;
    const top = s.top;
    const right = Math.min(s.right, left + h.length * CELL);
    ctx.save();
    for (const pass of [0, 1]) {
      const off = pass === 0 ? 1.6 : 0;
      ctx.beginPath();
      ctx.moveTo(left, top + 0.5);
      let prevX = left;
      let prevY = top - h[0] * 0.6;
      ctx.lineTo(prevX, prevY);
      for (let i = 0; i < h.length; i++) {
        const x = Math.min(right, left + i * CELL + CELL / 2);
        const y = top - h[i];
        ctx.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
        prevX = x;
        prevY = y;
      }
      ctx.lineTo(right, top - h[h.length - 1] * 0.6);
      ctx.lineTo(right, top + 0.5);
      ctx.closePath();
      if (pass === 0) {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#4a5878';
        ctx.translate(0, off);
        ctx.fill();
        ctx.translate(0, -off);
        ctx.globalAlpha = 1;
        continue;
      }
      const g = ctx.createLinearGradient(0, top - max, 0, top);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.7, '#f4f8ff');
      g.addColorStop(1, '#d9e3f2');
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
  }

  drawFree(ctx: Ctx2D) {
    const sprite = dotSprite(this.cx.sprites, 'flake', 8, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    ctx.save();
    ctx.fillStyle = '#fff';
    for (const f of this.flakes) {
      ctx.globalAlpha = 0.45 + f.depth * 0.55;
      const r = f.r * 1.5;
      if (sprite) ctx.drawImage(sprite as CanvasImageSource, f.x - r, f.y - r, r * 2, r * 2);
      else {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const c of this.clumps) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of this.puffs) {
      ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function rebuild(old: Pile, w: number) {
  const p = new Pile(w, old.maxHeight, old.maxSlope);
  p.heights.set(old.heights.subarray(0, Math.min(old.heights.length, p.heights.length)));
  return p;
}
