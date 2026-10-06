import { describe, expect, it } from 'vitest';
import { applyDeadzone, detectPadType, glyph, PB } from '../src/input/gamepad';
import { pickInDirection } from '../src/ui/padNav';
import { sanitizeSettings } from '../src/game/settings';

describe('gamepad', () => {
  it('detects controller families from ids', () => {
    expect(detectPadType('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox');
    expect(detectPadType('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(detectPadType('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(detectPadType('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('nintendo');
    expect(detectPadType('Joy-Con L+R (STANDARD GAMEPAD)')).toBe('nintendo');
    expect(detectPadType('Generic USB Joystick')).toBe('generic');
  });
  it('labels buttons by position per family', () => {
    expect(glyph('xbox', PB.SOUTH)).toBe('A');
    expect(glyph('playstation', PB.SOUTH)).toBe('✕');
    expect(glyph('playstation', PB.NORTH)).toBe('△');
    expect(glyph('nintendo', PB.SOUTH)).toBe('B'); // bottom button on Nintendo is labelled B
    expect(glyph('nintendo', PB.EAST)).toBe('A');
    expect(glyph('generic', PB.RT)).toBe('RT');
    expect(glyph('playstation', PB.RT)).toBe('R2');
    expect(glyph('nintendo', PB.RT)).toBe('ZR');
  });
  it('deadzone removes drift, keeps full deflection and direction', () => {
    expect(applyDeadzone(0.1, -0.1)).toEqual([0, 0]);
    const [x, y] = applyDeadzone(1, 0);
    expect(x).toBeCloseTo(1, 5);
    expect(y).toBe(0);
    const [a, b] = applyDeadzone(0.5, 0.5);
    expect(a).toBeCloseTo(b, 6);
    expect(Math.hypot(a, b)).toBeLessThan(Math.hypot(0.5, 0.5));
  });
  it('spatial navigation picks the nearest item in the pressed direction', () => {
    const r = (x: number, y: number) => ({ x, y, w: 100, h: 40 });
    const from = r(100, 100);
    const cands = [r(100, 160), r(100, 40), r(220, 100), r(400, 170), r(-20, 100)];
    expect(pickInDirection(from, cands, 0, 1)).toBe(0); // down
    expect(pickInDirection(from, cands, 0, -1)).toBe(1); // up
    expect(pickInDirection(from, cands, 1, 0)).toBe(2); // right (prefers same row over the far one)
    expect(pickInDirection(from, cands, -1, 0)).toBe(4); // left
    expect(pickInDirection(r(0, 0), [r(0, -100)], 0, 1)).toBe(-1); // nothing below
  });
  it('controller settings are sanitized', () => {
    const s = sanitizeSettings({ padSens: 9, vibration: 'x', padLayout: 'sega' });
    expect(s.padSens).toBe(3);
    expect(s.vibration).toBe(true);
    expect(s.padLayout).toBe('auto');
  });
});
