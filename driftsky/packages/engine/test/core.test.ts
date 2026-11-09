import { describe, expect, it } from 'vitest';
import { CELL, Pile, Rng, World, isEffectId } from '../src';
import { H, W, win } from './helpers';

describe('Rng', () => {
  it('is deterministic for a seed and stays in range', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const x = a.next();
      expect(x).toBe(b.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    const r = new Rng(1);
    for (let i = 0; i < 500; i++) {
      const v = r.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
});

describe('isEffectId', () => {
  it('accepts only known effects', () => {
    expect(isEffectId('snow')).toBe(true);
    expect(isEffectId('starfall')).toBe(true);
    expect(isEffectId('hail')).toBe(false);
    expect(isEffectId(undefined)).toBe(false);
  });
});

describe('Pile', () => {
  it('accumulates, never exceeds its cap, and keeps slopes gentle', () => {
    const p = new Pile(300, 12);
    for (let i = 0; i < 20000; i++) p.add((i * 37) % 300, 1);
    const h = Array.from(p.heights);
    expect(Math.max(...h)).toBeLessThanOrEqual(12 + 1e-3);
    expect(p.volume()).toBeGreaterThan(0);
    for (let i = 1; i < h.length; i++) expect(Math.abs(h[i] - h[i - 1])).toBeLessThanOrEqual(p.maxSlope * 1.5 + 1e-3);
  });

  it('holds less at the edges than in the middle', () => {
    const p = new Pile(300, 12);
    for (let i = 0; i < 20000; i++) p.add((i * 13) % 300, 1);
    expect(p.heights[0]).toBeLessThan(p.heights[50]);
    expect(p.heights[p.cells - 1]).toBeLessThan(p.heights[50]);
  });

  it('returns spill for drops outside the pile', () => {
    const p = new Pile(100, 10);
    expect(p.add(-5, 2)).toBe(2);
    expect(p.add(500, 2)).toBe(2);
    expect(p.volume()).toBe(0);
  });

  it('sheds a fraction and everything at fraction 1', () => {
    const p = new Pile(120, 10);
    for (let i = 0; i < 2000; i++) p.add(60, 1);
    const v0 = p.volume();
    const half = p.shed(0.5);
    expect(p.volume()).toBeCloseTo(v0 / 2, 0);
    expect(half.reduce((a, [, h]) => a + h * CELL, 0)).toBeCloseTo(v0 / 2, 0);
    p.shed(1);
    expect(p.volume()).toBe(0);
    expect(p.shed(0)).toEqual([]);
  });

  it('drops snow beyond a shrunken edge and keeps the rest', () => {
    const p = new Pile(300, 10);
    for (let i = 0; i < 5000; i++) p.add((i * 7) % 300, 1);
    const before = p.volume();
    const fallen = p.resize(150);
    expect(p.width).toBeLessThanOrEqual(153);
    expect(fallen.length).toBeGreaterThan(0);
    expect(p.volume()).toBeLessThan(before);
    expect(p.resize(150)).toEqual([]);
    // growing keeps snow and adds empty cells
    const v = p.volume();
    p.resize(600);
    expect(p.volume()).toBeGreaterThanOrEqual(v - 1);
  });

  it('melts', () => {
    const p = new Pile(60, 10);
    for (let i = 0; i < 500; i++) p.add(30, 1);
    p.melt(100);
    expect(p.volume()).toBe(0);
  });
});

describe('World', () => {
  it('orders surfaces windows → dock → ground and ignores junk windows', () => {
    const w = new World(1);
    w.resize(W, H);
    w.setWindows([win('a', 100, 100, 400, 300), win('tiny', 0, 0, 10, 10), { id: 'nan', x: NaN, y: 0, w: 100, h: 100 }, win('off', 5000, 0, 300, 300)]);
    w.setFloor({ x: 0, y: 830, w: W, h: 70 });
    w.sync(1 / 60);
    expect(w.surfaces.map((s) => s.kind)).toEqual(['window', 'dock', 'ground']);
    expect(w.surfaces[2].top).toBe(H);
  });

  it('only lets things land on exposed edges', () => {
    const w = new World(1);
    w.resize(W, H);
    // A in front, B behind with its top edge partly under A
    w.setWindows([win('A', 100, 100, 400, 300), win('B', 300, 200, 500, 300)]);
    w.sync(1 / 60);
    const B = w.get('w:B')!;
    expect(w.exposed(B, 350)).toBe(false); // under A
    expect(w.exposed(B, 700)).toBe(true); // to A's right
    expect(w.landing(350, 195, 205)).toBeNull();
    expect(w.landing(700, 195, 205)?.id).toBe('w:B');
    expect(w.landing(200, 95, 105)?.id).toBe('w:A');
    expect(w.landing(200, 105, 95)).toBeNull(); // moving up never lands
    expect(w.landing(50, H - 5, H + 5)?.kind).toBe('ground');
  });

  it('tracks velocity, stillness and removals', () => {
    const w = new World(1);
    w.resize(W, H);
    for (let i = 0; i < 30; i++) {
      w.setWindows([win('a', 100 + i * 10, 100, 400, 300)]);
      w.sync(1 / 60);
    }
    const a = w.get('w:a')!;
    expect(a.vx).toBeGreaterThan(400); // 10px/frame = 600px/s
    expect(a.stillFor).toBe(0);
    for (let i = 0; i < 60; i++) w.sync(1 / 60);
    expect(a.speed).toBe(0);
    expect(a.stillFor).toBeGreaterThan(0.9);
    w.setWindows([]);
    w.sync(1 / 60);
    expect(w.drainRemoved().map((s) => s.id)).toEqual(['w:a']);
    expect(w.drainRemoved()).toEqual([]);
  });

  it('tracks pointer stillness', () => {
    const w = new World(1);
    w.resize(W, H);
    w.setPointer({ x: 10, y: 10 });
    w.sync(1 / 60);
    for (let i = 0; i < 60; i++) w.sync(1 / 60);
    expect(w.pointer!.stillFor).toBeGreaterThan(0.9);
    w.setPointer({ x: 200, y: 10 });
    w.sync(1 / 60);
    expect(w.pointer!.stillFor).toBe(0);
    expect(w.pointer!.vx).toBeGreaterThan(0);
    w.setPointer(null);
    expect(w.pointer).toBeNull();
  });
});
