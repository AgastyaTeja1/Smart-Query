import { FrameLoop, WeatherEngine, type Ctx2D } from '@driftsky/engine';
import type { OverlayConfig, WorldFrame } from '../../shared/types';

declare global {
  interface Window {
    driftskyOverlay: {
      onConfig(cb: (c: OverlayConfig) => void): void;
      onWorld(cb: (w: WorldFrame) => void): void;
    };
    __overlay: { stats(): unknown };
  }
}

const canvas = document.getElementById('fx') as HTMLCanvasElement;
let ctx = canvas.getContext('2d')!;
const engine = new WeatherEngine({
  effect: 'off',
  createCanvas: (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c as never;
  },
});

function fit() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  engine.resize(innerWidth, innerHeight);
}
fit();
addEventListener('resize', fit);

const loop = new FrameLoop(engine, () => ctx as unknown as Ctx2D);
let config: OverlayConfig = { effect: 'off', intensity: 1, lowPower: false, paused: true };
let frames = 0;
let lastWorld = 0;

function apply(c: OverlayConfig) {
  const changedEffect = c.effect !== config.effect;
  config = c;
  if (changedEffect) engine.setEffect(c.effect);
  engine.setIntensity(c.intensity);
  engine.setLowPower(c.lowPower);
  // battery: half the particles and 30 fps
  loop.maxFps = c.lowPower ? 30 : 60;
  if (c.effect === 'off' || c.paused) {
    loop.stop();
    ctx.clearRect(0, 0, innerWidth, innerHeight);
  } else loop.start();
}

window.driftskyOverlay.onConfig(apply);
window.driftskyOverlay.onWorld((w) => {
  frames++;
  lastWorld = performance.now();
  engine.setWindows(w.windows);
  engine.setFloor(w.floor);
  engine.setPointer(w.pointer);
});

// for automated tests and debugging from devtools
window.__overlay = {
  stats: () => ({ ...engine.stats(), running: loop.isRunning, worldFrames: frames, msSinceWorld: lastWorld ? Math.round(performance.now() - lastWorld) : null, config, size: [innerWidth, innerHeight] }),
};
