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
    if (fps < targetFps * 0.8) {
      this.slowFor += dt;
      this.fastFor = 0;
      if (this.slowFor >= this.downAfter && this.scale > this.floor) {
        this.scale = Math.max(this.floor, +(this.scale * 0.8).toFixed(3));
        this.slowFor = 0;
        return true;
      }
    } else if (fps >= targetFps * 0.95) {
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
  }
}
