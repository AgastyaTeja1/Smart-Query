import { describe, expect, it } from 'vitest';
import { EFFECTS, Fireflies, Rain, Snow, Starfall, Tumble, WeatherEngine } from '../src';
import { H, W, makeEngine, mockCanvasFactory, mockCtx, run, win } from './helpers';

const snowOn = (e: WeatherEngine, id: string) => (e.active as Snow).piles.get(id)?.volume() ?? 0;

describe('Snow', () => {
  it('piles up on a window top, the Dock and the ground', () => {
    const e = makeEngine('snow');
    e.setWindows([win('a', 300, 300, 700, 400)]);
    e.setFloor({ x: 400, y: 840, w: 640, h: 60 });
    run(e, 60);
    expect(snowOn(e, 'w:a')).toBeGreaterThan(500);
    expect(snowOn(e, 'dock')).toBeGreaterThan(50);
    expect(snowOn(e, 'ground')).toBeGreaterThan(50);
    const p = (e.active as Snow).piles.get('w:a')!;
    // visible layer within a minute
    expect(Math.max(...p.heights)).toBeGreaterThan(3);
    expect(e.stats().landed).toBeGreaterThan(100);
  });

  it('flies off when the window is dragged fast and resettles elsewhere', () => {
    const e = makeEngine('snow');
    let x = 300;
    e.setWindows([win('a', x, 300, 700, 400)]);
    run(e, 60);
    const before = snowOn(e, 'w:a');
    const groundBefore = snowOn(e, 'ground');
    expect(before).toBeGreaterThan(500);
    // fling: 15px/frame = 900px/s for half a second
    run(e, 0.5, () => {
      x += 15;
      e.setWindows([win('a', x, 300, 700, 400)]);
    });
    expect(snowOn(e, 'w:a')).toBeLessThan(before * 0.1);
    expect(e.stats().shed).toBeGreaterThan(10);
    // clumps land on the ground within a couple of seconds
    run(e, 2);
    expect(snowOn(e, 'ground')).toBeGreaterThan(groundBefore);
  });

  it('keeps its snow when a window is nudged slowly', () => {
    const e = makeEngine('snow');
    let x = 300;
    e.setWindows([win('a', x, 300, 700, 400)]);
    run(e, 40);
    const before = snowOn(e, 'w:a');
    run(e, 2, (_t, i) => {
      if (i % 4 === 0) x += 1; // 15 px/s
      e.setWindows([win('a', x, 300, 700, 400)]);
    });
    expect(snowOn(e, 'w:a')).toBeGreaterThan(before * 0.9);
  });

  it('drops snow off the edge when a window gets narrower', () => {
    const e = makeEngine('snow');
    e.setWindows([win('a', 300, 300, 700, 400)]);
    run(e, 40);
    const before = snowOn(e, 'w:a');
    e.setWindows([win('a', 300, 300, 300, 400)]);
    run(e, 1 / 60);
    expect(snowOn(e, 'w:a')).toBeLessThan(before * 0.6);
    expect((e.active as Snow).clumps.length).toBeGreaterThan(0);
  });

  it('throws the snow when a window closes', () => {
    const e = makeEngine('snow');
    e.setWindows([win('a', 300, 300, 700, 400)]);
    run(e, 40);
    e.setWindows([]);
    run(e, 1 / 60);
    expect((e.active as Snow).piles.has('w:a')).toBe(false);
    expect((e.active as Snow).clumps.length).toBeGreaterThan(5);
  });

  it('never piles on the part of a window hidden behind another', () => {
    const e = makeEngine('snow');
    // front window covers back window's top edge from x=200..600
    e.setWindows([win('front', 200, 150, 400, 500), win('back', 100, 300, 900, 400)]);
    run(e, 60);
    const back = (e.active as Snow).piles.get('w:back')!;
    // cells for x in 250..550 (local 150..450) must be empty
    for (let lx = 150; lx < 450; lx += 3) expect(back.heightAt(lx)).toBe(0);
    expect(back.volume()).toBeGreaterThan(100); // but the exposed parts do collect
  });
});

describe('Rain', () => {
  it('splashes on windows and the ground', () => {
    const e = makeEngine('rain');
    e.setWindows([win('a', 300, 300, 700, 400)]);
    run(e, 5);
    expect(e.stats().splashes).toBeGreaterThan(100);
    expect((e.active as Rain).droplets.length).toBeGreaterThan(0);
  });
  it('flashes lightning now and then, and on demand', () => {
    const e = makeEngine('rain');
    run(e, 45);
    expect(e.stats().lightning).toBeGreaterThanOrEqual(1);
    const r = e.active as Rain;
    const n = e.stats().lightning;
    r.strike();
    expect(e.stats().lightning).toBe(n + 1);
    expect(r.flash).toBe(1);
    expect(r.bolt!.pts.length).toBeGreaterThan(3);
    run(e, 1);
    expect(r.flash).toBe(0);
    expect(r.bolt).toBeNull();
  });
});

describe('Sakura', () => {
  it('rests on windows for a while, then fades', () => {
    const e = makeEngine('sakura');
    e.setWindows([win('a', 300, 300, 700, 400)]);
    run(e, 30);
    const t = e.active as Tumble;
    const onWin = t.rest.filter((r) => r.sid === 'w:a');
    expect(onWin.length).toBeGreaterThan(3);
    expect(onWin.length).toBeLessThanOrEqual(Math.floor(7 * 2.2)); // capped per 100px
    // all have a finite life
    for (const r of t.rest) expect(r.life).toBeLessThanOrEqual(45);
  });
  it('blows off a dragged window', () => {
    const e = makeEngine('sakura');
    let x = 300;
    e.setWindows([win('a', x, 300, 700, 400)]);
    run(e, 30);
    const t = e.active as Tumble;
    const before = t.rest.filter((r) => r.sid === 'w:a').length;
    expect(before).toBeGreaterThan(0);
    run(e, 1, () => {
      x -= 20;
      e.setWindows([win('a', x, 300, 700, 400)]);
    });
    expect(t.rest.filter((r) => r.sid === 'w:a').length).toBeLessThan(before);
  });
});

describe('Leaves', () => {
  it('pile up and scatter when the pointer brushes past', () => {
    const e = makeEngine('leaves');
    e.setWindows([win('a', 300, 300, 700, 400)]);
    run(e, 40);
    const t = e.active as Tumble;
    const before = t.rest.filter((r) => r.sid === 'w:a').length;
    expect(before).toBeGreaterThan(5);
    // some leaves stack on others
    expect(t.rest.some((r) => r.ly > 0)).toBe(true);
    // sweep the pointer along the window's top edge, fast
    let px = 280;
    e.setPointer({ x: px, y: 296 });
    run(e, 0.6, () => {
      px += 22;
      e.setPointer({ x: px, y: 296 });
    });
    expect(t.rest.filter((r) => r.sid === 'w:a').length).toBeLessThan(before * 0.5);
    expect(e.stats().shed).toBeGreaterThan(3);
  });
  it('does not scatter for a still pointer', () => {
    const e = makeEngine('leaves');
    e.setWindows([win('a', 300, 300, 700, 400)]);
    e.setPointer({ x: 600, y: 296 });
    run(e, 40);
    const t = e.active as Tumble;
    expect(t.rest.filter((r) => r.sid === 'w:a').length).toBeGreaterThan(5);
    expect(e.stats().shed).toBe(0);
  });
});

describe('Fireflies', () => {
  it('gather around a resting pointer and scatter when it darts', () => {
    const e = makeEngine('fireflies');
    e.active!.prewarm();
    e.setPointer({ x: 700, y: 450 });
    run(e, 8);
    const f = e.active as Fireflies;
    const n = f.flies.length;
    expect(e.stats().gathered).toBeGreaterThan(n * 0.5);
    // dart away quickly
    let px = 700;
    run(e, 0.3, () => {
      px += 40;
      e.setPointer({ x: px, y: 450 });
    });
    run(e, 0.5);
    e.setPointer({ x: px, y: 450 });
    expect(f.gatheredCount()).toBeLessThan(n * 0.5);
  });
  it('wander when there is no pointer and stay on screen', () => {
    const e = makeEngine('fireflies');
    e.active!.prewarm();
    run(e, 30);
    for (const fly of (e.active as Fireflies).flies) {
      expect(fly.x).toBeGreaterThanOrEqual(-20);
      expect(fly.x).toBeLessThanOrEqual(W + 20);
      expect(fly.y).toBeGreaterThanOrEqual(-20);
      expect(fly.y).toBeLessThanOrEqual(H + 20);
    }
  });
});

describe('Starfall', () => {
  it('bursts into sparks on a window top', () => {
    const e = makeEngine('starfall');
    e.setWindows([win('a', 300, 300, 700, 400)]);
    run(e, 1 / 60);
    const s = e.active as Starfall;
    const b0 = e.stats().bursts;
    s.launch({ x: 500, y: 200, vx: 0, vy: 800 });
    run(e, 0.2);
    expect(e.stats().bursts).toBeGreaterThan(b0);
    expect(s.sparks.some((p) => Math.abs(p.y - 300) < 40 && p.x > 450 && p.x < 550)).toBe(true);
  });
  it('keeps a steady stream of meteors', () => {
    const e = makeEngine('starfall');
    run(e, 20);
    expect(e.stats().bursts).toBeGreaterThan(8);
  });
});

describe('WeatherEngine', () => {
  it('halves the particles on battery', () => {
    const full = makeEngine('snow');
    const half = makeEngine('snow', { lowPower: true });
    full.active!.prewarm();
    half.active!.prewarm();
    expect(half.stats().particles).toBeLessThanOrEqual(Math.ceil(full.stats().particles / 2) + 1);
    expect(half.stats().particles).toBeGreaterThan(full.stats().particles / 2 - 5);
    // toggling at runtime trims immediately
    full.setLowPower(true);
    expect(full.stats().particles).toBeLessThanOrEqual(half.stats().particles + 1);
  });

  it('scales with intensity and clamps bad values', () => {
    const lo = makeEngine('rain', { intensity: 0.25 });
    const hi = makeEngine('rain', { intensity: 2 });
    const bad = makeEngine('rain', { intensity: NaN });
    for (const e of [lo, hi, bad]) e.active!.prewarm();
    expect(hi.stats().particles).toBeGreaterThan(lo.stats().particles * 4);
    expect(bad.stats().particles).toBeGreaterThan(lo.stats().particles);
  });

  it('switches effects and turns off', () => {
    const e = makeEngine('snow');
    run(e, 2);
    for (const id of EFFECTS) {
      e.setEffect(id, { prewarm: true });
      expect(e.currentEffect).toBe(id);
      run(e, 0.5);
      expect(e.stats().particles).toBeGreaterThan(0);
    }
    e.setEffect('off');
    run(e, 0.5);
    expect(e.stats().particles).toBe(0);
  });

  it('survives huge, zero, negative and NaN time steps', () => {
    const e = makeEngine('snow');
    e.setWindows([win('a', 300, 300, 700, 400)]);
    for (const dt of [0, -1, NaN, Infinity, 3600, 1e-9]) e.update(dt);
    run(e, 1);
    const s = e.stats();
    expect(Number.isFinite(s.piled)).toBe(true);
    for (const f of (e.active as Snow).flakes) expect(Number.isFinite(f.x + f.y)).toBe(true);
  });

  it('handles a screen resize mid-flight', () => {
    const e = makeEngine('snow');
    run(e, 5);
    e.resize(800, 600);
    run(e, 5);
    e.resize(3840, 2160);
    run(e, 5);
    expect(e.stats().particles).toBeGreaterThan(100);
  });

  it('draws every effect without errors, with and without sprites', () => {
    for (const createCanvas of [undefined, mockCanvasFactory()]) {
      for (const id of EFFECTS) {
        const e = new WeatherEngine({ effect: id, seed: 3, createCanvas });
        e.resize(W, H);
        e.setWindows([win('a', 300, 300, 700, 400)]);
        e.setFloor({ x: 0, y: 860, w: W, h: 40 });
        e.setPointer({ x: 500, y: 500 });
        run(e, 20);
        if (id === 'rain') (e.active as Rain).strike();
        const { ctx, calls } = mockCtx();
        e.draw(ctx);
        expect(calls.length).toBeGreaterThan(5);
        expect(calls[0][0]).toBe('clearRect');
      }
    }
  });

  it('clears windows back to front so front windows hide piles behind them', () => {
    const e = makeEngine('snow');
    e.setWindows([win('front', 200, 150, 400, 500), win('back', 100, 300, 900, 400)]);
    run(e, 30);
    const { ctx, calls } = mockCtx();
    e.draw(ctx);
    const clears = calls.filter(([k]) => k === 'clearRect').map(([, a]) => a);
    expect(clears[0]).toEqual([0, 0, W, H]);
    expect(clears[1]).toEqual([100, 300, 900, 400]); // back first
    expect(clears[2]).toEqual([200, 150, 400, 500]); // then front
  });

  it('runs a busy snow scene fast enough for 60 fps', () => {
    const e = makeEngine('snow', { intensity: 2 });
    const wins = Array.from({ length: 12 }, (_, i) => win(String(i), 50 + i * 100, 100 + (i % 4) * 150, 500, 300));
    e.setWindows(wins);
    run(e, 30);
    const t0 = performance.now();
    run(e, 10, (_t, i) => {
      // keep one window moving the whole time
      wins[0] = win('0', 50 + (i % 200) * 4, 100, 500, 300);
      e.setWindows(wins);
    });
    const perFrame = (performance.now() - t0) / 600;
    expect(perFrame).toBeLessThan(4); // ms per simulated frame
  });
});

describe('settle()', () => {
  it('produces piles comparable to really simulating, in a fraction of the time', () => {
    const sim = makeEngine('snow', { seed: 9 });
    sim.setWindows([win('a', 300, 300, 700, 400)]);
    sim.active!.prewarm();
    run(sim, 60);
    const real = snowOn(sim, 'w:a');

    const fast = makeEngine('snow', { seed: 9 });
    fast.setWindows([win('a', 300, 300, 700, 400)]);
    const t0 = performance.now();
    fast.settle(60);
    const ms = performance.now() - t0;
    const settled = snowOn(fast, 'w:a');
    expect(ms).toBeLessThan(40);
    expect(settled).toBeGreaterThan(real * 0.5);
    expect(settled).toBeLessThan(real * 2);
    expect(fast.stats().particles).toBeGreaterThan(100);
  });

  it('respects occlusion when settling', () => {
    const e = makeEngine('snow');
    e.setWindows([win('front', 200, 150, 400, 500), win('back', 100, 300, 900, 400)]);
    e.settle(90);
    const back = (e.active as Snow).piles.get('w:back')!;
    for (let lx = 150; lx < 450; lx += 3) expect(back.heightAt(lx)).toBe(0);
    expect(back.volume()).toBeGreaterThan(100);
  });

  it('places resting petals and leaves within their caps', () => {
    for (const id of ['sakura', 'leaves'] as const) {
      const e = makeEngine(id);
      e.setWindows([win('a', 300, 300, 700, 400)]);
      e.settle(60);
      const t = e.active as Tumble;
      const onWin = t.rest.filter((r) => r.sid === 'w:a').length;
      expect(onWin).toBeGreaterThan(3);
      expect(onWin).toBeLessThanOrEqual(Math.max(3, Math.floor(7 * t.cfg.restPer100)));
    }
  });

  it('is a no-op for effects with nothing to settle, and for off', () => {
    for (const id of ['rain', 'fireflies', 'starfall', 'off'] as const) {
      const e = makeEngine(id);
      e.setWindows([win('a', 300, 300, 700, 400)]);
      expect(() => e.settle(60)).not.toThrow();
    }
  });
});

describe('Starfall at any screen size', () => {
  it('meteors reach the screen and burst on small and portrait screens too', () => {
    for (const [w, h] of [
      [480, 300],
      [360, 640],
      [3840, 2160],
    ]) {
      const e = makeEngine('starfall');
      e.resize(w, h);
      e.setWindows([win('a', w * 0.2, h * 0.5, w * 0.5, h * 0.3)]);
      run(e, 20);
      expect(e.stats().bursts).toBeGreaterThan(8);
    }
  });
});
