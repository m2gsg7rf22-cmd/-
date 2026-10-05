import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, STEP_ORDER } from '../src/game/adaptive';

function run(aq: AdaptiveQuality, fps: number, seconds: number) {
  const steps: string[] = [];
  const dt = 1 / fps;
  for (let t = 0; t < seconds; t += dt) {
    const s = aq.feed(dt);
    if (s) steps.push(s);
  }
  return steps;
}

describe('adaptive quality', () => {
  it('does nothing at good fps', () => {
    expect(run(new AdaptiveQuality(60, 3, 8, 2), 60, 60)).toEqual([]);
  });
  it('steps down gradually with cooldown at low fps', () => {
    const aq = new AdaptiveQuality(60, 3, 8, 2);
    aq.reset();
    const steps = run(aq, 20, 30);
    expect(steps.length).toBeGreaterThan(0);
    // 30s with 8s cooldown + 6s windows => at most ~3 steps, never one per frame
    expect(steps.length).toBeLessThanOrEqual(3);
    expect(steps[0]).toBe(STEP_ORDER[0]);
  });
  it('ignores single hitches', () => {
    const aq = new AdaptiveQuality(60, 3, 0, 2);
    const steps = [...run(aq, 60, 10), aq.feed(2), ...run(aq, 60, 10)];
    expect(steps.filter(Boolean)).toEqual([]);
  });
  it('requires sustained low fps (hysteresis)', () => {
    const aq = new AdaptiveQuality(60, 3, 0, 2);
    const steps = [...run(aq, 30, 3.1), ...run(aq, 60, 3.1), ...run(aq, 30, 3.1), ...run(aq, 60, 3.1)];
    expect(steps).toEqual([]);
  });
  it('stops after exhausting all steps', () => {
    const aq = new AdaptiveQuality(60, 1, 0, 1);
    const steps = run(aq, 10, 100);
    expect(steps.length).toBe(STEP_ORDER.length);
  });
});
