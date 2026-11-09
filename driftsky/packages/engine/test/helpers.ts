import { WeatherEngine, type EffectId, type WindowRect } from '../src';

export const W = 1440;
export const H = 900;

export function makeEngine(effect: EffectId | 'off', opts: { seed?: number; intensity?: number; lowPower?: boolean } = {}) {
  const e = new WeatherEngine({ effect, seed: opts.seed ?? 42, intensity: opts.intensity, lowPower: opts.lowPower });
  e.resize(W, H);
  return e;
}

/** Run `seconds` of simulation at 60 fps, calling `each` before every frame. */
export function run(e: WeatherEngine, seconds: number, each?: (t: number, frame: number) => void) {
  const dt = 1 / 60;
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    each?.(i * dt, i);
    e.update(dt);
  }
}

export const win = (id: string, x: number, y: number, w: number, h: number): WindowRect => ({ id, x, y, w, h });

/** A CanvasRenderingContext2D stand-in that records calls. */
export function mockCtx() {
  const calls: Array<[string, unknown[]]> = [];
  const grad = { addColorStop() {} };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a: unknown[]) => (calls.push([k, a]), grad);
      return (...a: unknown[]) => {
        calls.push([k, a]);
      };
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  };
  const ctx = new Proxy<Record<string, unknown>>(
    { globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt' },
    handler,
  );
  return { ctx: ctx as never, calls };
}

/** A canvas factory backed by mock contexts, so sprite code paths run in Node. */
export function mockCanvasFactory() {
  return (w: number, h: number) => ({ width: w, height: h, getContext: () => mockCtx().ctx });
}
