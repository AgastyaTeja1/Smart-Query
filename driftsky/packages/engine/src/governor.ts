/**
 * Keeps the weather smooth on slower Macs: when frames run slow for a few seconds, thin the
 * particles step by step (never below `floor` of what the user chose); when there's headroom again,
 * bring them back slowly. Smoothness beats density.
 */
export class QualityGovernor {
  /** Multiplier applied to the chosen intensity (floor..1). */
  scale = 1;
  private slowFor = 0;
  private fastFor = 0;
  /** Frame rate just before the last step down, to check the step helped. */
  private fpsBeforeStep: number | null = null;
  private scaleBeforeStep = 1;
  private checkFor = 0;
  /**
   * The display itself can't go faster than this (a 30 Hz screen, a virtual display). Thinning
   * the weather can't help there, so the full amount is kept and this becomes the target.
   */
  ceiling: number | null = null;

  constructor(
    /** Never thin below this share of the chosen amount. */
    readonly floor = 0.4,
    /** Seconds of slow frames before stepping down. */
    readonly downAfter = 2,
    /** Seconds of smooth frames before stepping back up. */
    readonly upAfter = 8,
  ) {}

  /**
   * Feed the measured frame rate and the time since the last call. Returns true when `scale`
   * changed (apply it then).
   */
  update(fps: number, targetFps: number, dt: number): boolean {
    if (!(dt > 0) || !Number.isFinite(fps)) return false;
    // step down against what the display can do; only step back up when truly smooth
    const upTarget = targetFps;
    if (this.ceiling) targetFps = Math.min(targetFps, this.ceiling);
    // did the last step down actually help? If not, the limit isn't the particles
    if (this.fpsBeforeStep !== null) {
      this.checkFor += dt;
      if (this.checkFor < this.downAfter) return false;
      const before = this.fpsBeforeStep;
      this.fpsBeforeStep = null;
      this.checkFor = 0;
      if (fps < before * 1.08) {
        // that step didn't buy frames: undo it, and treat this rate as what the display can do
        this.ceiling = Math.max(1, Math.round(Math.max(fps, before)));
        this.scale = this.scaleBeforeStep;
        this.slowFor = this.fastFor = 0;
        return true;
      }
    }
    if (fps < targetFps * 0.8) {
      this.slowFor += dt;
      this.fastFor = 0;
      if (this.slowFor >= this.downAfter && this.scale > this.floor) {
        this.fpsBeforeStep = fps;
        this.scaleBeforeStep = this.scale;
        this.checkFor = 0;
        this.scale = Math.max(this.floor, +(this.scale * 0.8).toFixed(3));
        this.slowFor = 0;
        return true;
      }
    } else if (fps >= upTarget * 0.95) {
      this.fastFor += dt;
      this.slowFor = 0;
      if (this.fastFor >= this.upAfter && this.scale < 1) {
        this.scale = Math.min(1, +(this.scale * 1.15).toFixed(3));
        this.fastFor = 0;
        return true;
      }
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    return false;
  }

  reset() {
    this.scale = 1;
    this.slowFor = this.fastFor = 0;
    this.fpsBeforeStep = null;
    this.checkFor = 0;
  }
}
