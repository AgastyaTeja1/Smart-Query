export const EFFECTS = ['snow', 'rain', 'sakura', 'leaves', 'fireflies', 'starfall'] as const;
export type EffectId = (typeof EFFECTS)[number];

export function isEffectId(v: unknown): v is EffectId {
  return typeof v === 'string' && (EFFECTS as readonly string[]).includes(v);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A window on screen, in overlay (CSS pixel) coordinates. Lists are ordered front-to-back. */
export interface WindowRect extends Rect {
  id: string;
}

export interface EngineOptions {
  effect: EffectId | 'off';
  /** 0.25 – 2. Scales particle counts. */
  intensity?: number;
  /** Battery / Low Power mode: halves the effect. */
  lowPower?: boolean;
  /** Deterministic randomness for tests. */
  seed?: number;
  /** Factory for offscreen canvases (sprites). Omit in tests that never draw. */
  createCanvas?: (w: number, h: number) => CanvasLike;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): Ctx2D | null;
}

/**
 * The subset of CanvasRenderingContext2D the engine uses. Declared structurally so tests can
 * pass a recording mock and the engine runs with OffscreenCanvas or HTMLCanvasElement alike.
 */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'closePath'
  | 'moveTo'
  | 'lineTo'
  | 'quadraticCurveTo'
  | 'arc'
  | 'ellipse'
  | 'rect'
  | 'fill'
  | 'stroke'
  | 'clip'
  | 'fillRect'
  | 'clearRect'
  | 'drawImage'
  | 'translate'
  | 'rotate'
  | 'scale'
  | 'setTransform'
  | 'createLinearGradient'
  | 'createRadialGradient'
> & {
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
};

export interface EngineStats {
  effect: EffectId | 'off';
  particles: number;
  /** Total snow volume sitting on surfaces (px², approximate). */
  piled: number;
  /** Things resting on surfaces (petals, leaves). */
  resting: number;
  landed: number;
  shed: number;
  splashes: number;
  bursts: number;
  lightning: number;
  gathered: number;
  surfaces: number;
  fps: number;
}
