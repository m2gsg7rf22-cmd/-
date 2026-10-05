/**
 * Adaptive quality controller. Feeds on frame times; when the average FPS over a window
 * stays below target for consecutive windows, it recommends ONE step down, then waits
 * a cooldown before considering another. Never changes quality every frame.
 */
export type QualityStep = 'particles' | 'clouds' | 'resolution' | 'renderDistance' | 'ao';

export const STEP_ORDER: QualityStep[] = ['particles', 'clouds', 'resolution', 'renderDistance', 'resolution', 'renderDistance', 'ao', 'renderDistance'];

export class AdaptiveQuality {
  private acc = 0;
  private frames = 0;
  private badWindows = 0;
  private cooldown = 0;
  private stepIndex = 0;
  lastFps = 60;

  constructor(
    public targetFps: number,
    private windowSec = 3,
    private cooldownSec = 8,
    private windowsNeeded = 2,
  ) {}

  reset(): void {
    this.acc = 0;
    this.frames = 0;
    this.badWindows = 0;
    this.cooldown = this.cooldownSec;
  }

  get exhausted(): boolean {
    return this.stepIndex >= STEP_ORDER.length;
  }

  /** dt in seconds. Returns a step to apply, or null. */
  feed(dt: number): QualityStep | null {
    // Ignore giant hitches (tab switches, loading) — they aren't sustained performance.
    if (dt > 0.5) return null;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.acc += dt;
    this.frames++;
    if (this.acc < this.windowSec) return null;
    const fps = this.frames / this.acc;
    this.lastFps = fps;
    this.acc = 0;
    this.frames = 0;
    // Hysteresis: only "bad" when clearly under target.
    if (fps < this.targetFps * 0.85) this.badWindows++;
    else this.badWindows = 0;
    if (this.badWindows >= this.windowsNeeded && this.cooldown <= 0 && !this.exhausted) {
      this.badWindows = 0;
      this.cooldown = this.cooldownSec;
      return STEP_ORDER[this.stepIndex++];
    }
    return null;
  }
}
