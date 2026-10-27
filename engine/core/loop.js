// Fixed-timestep game loop with interpolation-free rendering, time scaling (slow-mo,
// hit-stop) and a manual stepping mode used by automated tests.
export class GameLoop {
  constructor({ step = 1 / 60, maxSubSteps = 5 } = {}) {
    this.step = step;
    this.maxSubSteps = maxSubSteps;
    this.timeScale = 1;
    this.hitStop = 0; // seconds of frozen simulation (combat feel)
    this.paused = false;
    this.manual = false;
    this.time = 0;      // simulated seconds
    this.frame = 0;
    this.acc = 0;
    this.updaters = []; // fn(dt, time) sorted by order
    this.renderers = [];
    this._last = 0;
    this._raf = 0;
    this.fps = 0; this._fpsAcc = 0; this._fpsFrames = 0;
    this.frameMs = 0;
  }
  add(fn, order = 0) { this.updaters.push({ fn, order }); this.updaters.sort((a, b) => a.order - b.order); return () => this.remove(fn); }
  remove(fn) { this.updaters = this.updaters.filter((u) => u.fn !== fn); }
  onRender(fn) { this.renderers.push(fn); }
  tick(dt) {
    if (this.hitStop > 0) { this.hitStop = Math.max(0, this.hitStop - dt); return; }
    const sdt = dt * this.timeScale;
    this.time += sdt;
    this.frame++;
    for (const u of this.updaters) u.fn(sdt, this.time);
  }
  // Advance N fixed steps synchronously (tests, deterministic replays).
  advance(frames = 1) {
    for (let i = 0; i < frames; i++) this.tick(this.step);
    this.render(0);
  }
  render(alpha) { for (const r of this.renderers) r(alpha); }
  start() {
    if (typeof requestAnimationFrame === 'undefined') return;
    this._last = performance.now();
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      let real = (now - this._last) / 1000;
      this._last = now;
      if (real > 0.25) real = 0.25;
      this._fpsAcc += real; this._fpsFrames++;
      if (this._fpsAcc >= 0.5) { this.fps = this._fpsFrames / this._fpsAcc; this._fpsAcc = 0; this._fpsFrames = 0; }
      if (this.manual) return;
      const t0 = performance.now();
      if (!this.paused) {
        this.acc += real;
        let n = 0;
        while (this.acc >= this.step && n < this.maxSubSteps) { this.tick(this.step); this.acc -= this.step; n++; }
        if (n === this.maxSubSteps) this.acc = 0;
      }
      this.render(this.acc / this.step);
      this.frameMs = performance.now() - t0;
    };
    this._raf = requestAnimationFrame(loop);
  }
  stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; }
}
