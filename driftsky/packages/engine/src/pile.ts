/**
 * A height field of settled snow along a surface's top edge, stored in surface-local coordinates
 * so it rides along with a window that moves slowly. Cells are CELL px wide.
 */
export const CELL = 3;

export class Pile {
  heights: Float32Array;
  constructor(
    width: number,
    public maxHeight: number,
    /** Max height difference between neighbouring cells (angle of repose). */
    public maxSlope = 1.6,
  ) {
    this.heights = new Float32Array(Math.max(1, Math.ceil(width / CELL)));
  }

  get cells() {
    return this.heights.length;
  }

  get width() {
    return this.heights.length * CELL;
  }

  /** Total volume (px²). */
  volume(): number {
    let v = 0;
    for (let i = 0; i < this.heights.length; i++) v += this.heights[i];
    return v * CELL;
  }

  heightAt(localX: number): number {
    const i = Math.floor(localX / CELL);
    if (i < 0 || i >= this.heights.length) return 0;
    return this.heights[i];
  }

  /**
   * Add `amount` px of height at localX. Snow piles less near the edges (it rolls off), and
   * cells relax towards the angle of repose. Returns the amount that didn't fit (fell off).
   */
  add(localX: number, amount: number): number {
    const n = this.heights.length;
    const i = Math.floor(localX / CELL);
    if (i < 0 || i >= n) return amount;
    // spread over a small neighbourhood for a soft look
    let spilled = 0;
    const share = [0.2, 0.6, 0.2];
    for (let k = -1; k <= 1; k++) {
      const j = i + k;
      const a = amount * share[k + 1];
      if (j < 0 || j >= n) {
        spilled += a;
        continue;
      }
      // edge falloff: the outermost few cells only hold a thin rim
      const e = Math.min(j, n - 1 - j);
      const c = this.maxHeight * Math.min(1, 0.25 + e / 6);
      const room = Math.max(0, c - this.heights[j]);
      const put = Math.min(room, a);
      this.heights[j] += put;
      spilled += a - put;
    }
    this.relax(Math.max(0, i - 6), Math.min(n - 1, i + 6));
    return spilled;
  }

  /** Let steep steps slide sideways. Material sliding past an end is lost (falls off). */
  relax(from = 0, to = this.heights.length - 1): number {
    const h = this.heights;
    let lost = 0;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = from; i <= to; i++) {
        for (const j of [i - 1, i + 1]) {
          if (j < 0 || j >= h.length) {
            // overhang off the end: the rim can't be steeper than the slope either
            if (h[i] > this.maxSlope * 1.5) {
              const d = (h[i] - this.maxSlope * 1.5) * 0.5;
              h[i] -= d;
              lost += d;
            }
            continue;
          }
          const diff = h[i] - h[j];
          if (diff > this.maxSlope) {
            const move = (diff - this.maxSlope) / 2;
            h[i] -= move;
            h[j] += move;
          }
        }
      }
    }
    return lost * CELL;
  }

  /**
   * Remove a fraction (0..1) of every cell. Returns removed chunks as [localX, height] pairs so the
   * caller can turn them into falling clumps.
   */
  shed(fraction: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    if (fraction <= 0) return out;
    const f = Math.min(1, fraction);
    for (let i = 0; i < this.heights.length; i++) {
      const h = this.heights[i];
      if (h <= 0.05) {
        this.heights[i] = 0;
        continue;
      }
      const take = f >= 1 ? h : h * f;
      this.heights[i] = h - take;
      out.push([i * CELL + CELL / 2, take]);
    }
    return out;
  }

  /** Window resized: keep snow where it is (left-anchored); snow past the new right edge falls. */
  resize(newWidth: number): Array<[number, number]> {
    const n = Math.max(1, Math.ceil(newWidth / CELL));
    if (n === this.heights.length) return [];
    const old = this.heights;
    const next = new Float32Array(n);
    next.set(old.subarray(0, Math.min(n, old.length)));
    const fallen: Array<[number, number]> = [];
    for (let i = n; i < old.length; i++) if (old[i] > 0.05) fallen.push([i * CELL + CELL / 2, old[i]]);
    this.heights = next;
    // the new right edge is an edge now: let it slump
    this.relax(Math.max(0, n - 8), n - 1);
    return fallen;
  }

  /** Slowly melt (used for ground/dock so they never fill up). */
  melt(amountPerCell: number) {
    const h = this.heights;
    for (let i = 0; i < h.length; i++) h[i] = h[i] > amountPerCell ? h[i] - amountPerCell : 0;
  }

  clear() {
    this.heights.fill(0);
  }
}
