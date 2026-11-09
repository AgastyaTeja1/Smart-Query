import type { WeatherEngine } from './engine';
import type { Ctx2D } from './types';

/**
 * requestAnimationFrame driver with an optional frame-rate cap (30 fps on battery) and pause.
 * Works in browsers and Electron renderers.
 */
export class FrameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  maxFps = 60;

  constructor(
    private engine: WeatherEngine,
    private ctx: () => Ctx2D | null,
    private onFrame?: (dt: number) => void,
  ) {}

  get isRunning() {
    return this.running;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const dt = (now - this.last) / 1000;
      this.last = now;
      this.acc += dt;
      const minStep = 1 / this.maxFps - 0.002;
      if (this.acc < minStep) return;
      const step = this.acc;
      this.acc = 0;
      this.engine.update(step);
      const c = this.ctx();
      if (c) this.engine.draw(c);
      this.onFrame?.(step);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
