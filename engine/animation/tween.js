// Tweens and easing for UI, cinematics and procedural motion.
export const Ease = {
  linear: (t) => t, inQuad: (t) => t * t, outQuad: (t) => t * (2 - t), inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3), inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  outElastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; },
};
export class Tween {
  constructor(target, to, duration = 1, { ease = Ease.inOutQuad, delay = 0, onUpdate, onComplete } = {}) {
    this.target = target; this.to = to; this.duration = duration; this.ease = ease; this.delay = delay; this.onUpdate = onUpdate; this.onComplete = onComplete;
    this.t = 0; this.from = null; this.done = false;
  }
  update(dt) {
    if (this.done) return true;
    if (this.delay > 0) { this.delay -= dt; return false; }
    if (!this.from) { this.from = {}; for (const k in this.to) this.from[k] = this.target[k]; }
    this.t = Math.min(1, this.t + dt / this.duration);
    const e = this.ease(this.t);
    for (const k in this.to) this.target[k] = this.from[k] + (this.to[k] - this.from[k]) * e;
    this.onUpdate?.(e);
    if (this.t >= 1) { this.done = true; this.onComplete?.(); }
    return this.done;
  }
}
export class Tweens {
  constructor() { this.list = []; }
  to(target, props, duration, opts) { const tw = new Tween(target, props, duration, opts); this.list.push(tw); return tw; }
  wait(seconds) { return new Promise((r) => this.list.push(new Tween({ v: 0 }, { v: 1 }, seconds, { onComplete: r }))); }
  update(dt) { this.list = this.list.filter((t) => !t.update(dt)); }
}
