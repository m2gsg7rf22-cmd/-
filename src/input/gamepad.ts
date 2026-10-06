/**
 * Gamepad support (Xbox, PlayStation, Nintendo Switch Pro / Joy-Con pairs, generic XInput pads)
 * through the browser's Gamepad API "standard" mapping. Buttons are addressed by POSITION
 * (bottom face button = 0, right = 1, left = 2, top = 3), so every controller family plays the
 * same; only the on-screen glyphs differ per family.
 */

export type PadType = 'xbox' | 'playstation' | 'nintendo' | 'generic';
export type PadLayout = 'auto' | 'xbox' | 'playstation' | 'nintendo';

/** Standard-mapping button indices. */
export const PB = {
  SOUTH: 0, // A / ✕ / B(Nintendo)
  EAST: 1, // B / ○ / A(Nintendo)
  WEST: 2, // X / □ / Y(Nintendo)
  NORTH: 3, // Y / △ / X(Nintendo)
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  SELECT: 8, // View / Create / −
  START: 9, // Menu / Options / +
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

/** Detect controller family from the Gamepad.id string (vendor ids + names). */
export function detectPadType(id: string): PadType {
  const s = id.toLowerCase();
  // Xbox first: its name also contains "Wireless Controller", which a DualShock 4 reports on its own.
  if (/045e|xbox|xinput|microsoft/.test(s)) return 'xbox';
  if (/054c|playstation|dualshock|dualsense|wireless controller|ps[345]/.test(s)) return 'playstation';
  if (/057e|nintendo|pro controller|joy-con|joycon|switch/.test(s)) return 'nintendo';
  return 'generic';
}

/**
 * Radial deadzone with a smooth response curve: small stick drift is ignored and
 * fine aiming near the center stays precise. Returns a vector with magnitude 0..1.
 */
export function applyDeadzone(x: number, y: number, dead = 0.18, curve = 1.6): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dead) return [0, 0];
  const n = Math.min(1, (m - dead) / (1 - dead));
  const k = Math.pow(n, curve) / m;
  return [x * k, y * k];
}

const GLYPHS: Record<Exclude<PadType, 'generic'>, Record<number, string>> = {
  xbox: { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'View', 9: 'Menu', 10: 'LS', 11: 'RS', 12: '↑', 13: '↓', 14: '←', 15: '→' },
  playstation: { 0: '✕', 1: '○', 2: '□', 3: '△', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'Create', 9: 'Options', 10: 'L3', 11: 'R3', 12: '↑', 13: '↓', 14: '←', 15: '→' },
  // Nintendo face labels by position: bottom B, right A, left Y, top X.
  nintendo: { 0: 'B', 1: 'A', 2: 'Y', 3: 'X', 4: 'L', 5: 'R', 6: 'ZL', 7: 'ZR', 8: '−', 9: '+', 10: 'LS', 11: 'RS', 12: '↑', 13: '↓', 14: '←', 15: '→' },
};

export function glyph(type: PadType, button: number): string {
  return GLYPHS[type === 'generic' ? 'xbox' : type][button] ?? '?';
}

/** CSS class for colored face-button glyphs. */
export function glyphClass(type: PadType, button: number): string {
  if (button > 3) return 'pg-shoulder';
  return `pg-${type === 'generic' ? 'xbox' : type}-${button}`;
}

export interface PadSnapshot {
  connected: boolean;
  type: PadType;
  name: string;
  /** Left stick (move) and right stick (look), deadzoned, y up = positive for left stick. */
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  down: boolean[];
  pressed: boolean[];
  released: boolean[];
  /** Analog trigger values 0..1. */
  lt: number;
  rt: number;
}

const EMPTY: PadSnapshot = {
  connected: false, type: 'generic', name: '', lx: 0, ly: 0, rx: 0, ry: 0,
  down: new Array(17).fill(false), pressed: new Array(17).fill(false), released: new Array(17).fill(false), lt: 0, rt: 0,
};

/** Polls the first connected gamepad once per frame and tracks button edges. */
export class GamepadManager {
  state: PadSnapshot = { ...EMPTY };
  /** True when the gamepad was the most recently used input device. */
  active = false;
  layout: PadLayout = 'auto';
  vibration = true;
  private prev: boolean[] = new Array(17).fill(false);
  private lastFrame = -1;
  private index = -1;
  onConnect?: (name: string, type: PadType) => void;
  onDisconnect?: () => void;
  private wasConnected = false;

  constructor() {
    const mark = () => (this.active = false);
    // Any keyboard/mouse/touch use hands control back to those devices (for prompts and hints).
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', mark, { capture: true });
      window.addEventListener('pointerdown', (e) => {
        if (e.isTrusted) mark();
      }, { capture: true });
      window.addEventListener('gamepadconnected', () => this.poll(true));
      window.addEventListener('gamepaddisconnected', () => this.poll(true));
    }
  }

  get type(): PadType {
    if (this.layout !== 'auto') return this.layout;
    return this.state.type;
  }

  /** Read the pad. Safe to call many times per frame; only the first call per frame reads hardware. */
  poll(force = false): PadSnapshot {
    const now = typeof performance !== 'undefined' ? Math.floor(performance.now()) : 0;
    if (!force && now === this.lastFrame) return this.state;
    this.lastFrame = now;
    let pads: (Gamepad | null)[] = [];
    try {
      pads = typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    } catch {
      pads = [];
    }
    let gp: Gamepad | null = null;
    if (this.index >= 0) gp = pads[this.index] ?? null;
    if (!gp || !gp.connected) {
      gp = pads.find((p) => p && p.connected) ?? null;
      this.index = gp ? gp.index : -1;
    }
    if (!gp) {
      if (this.wasConnected) {
        this.wasConnected = false;
        this.active = false;
        this.onDisconnect?.();
      }
      this.state = { ...EMPTY };
      this.prev.fill(false);
      return this.state;
    }
    const type = detectPadType(gp.id);
    if (!this.wasConnected) {
      this.wasConnected = true;
      this.onConnect?.(gp.id, type);
    }
    const down: boolean[] = [];
    for (let i = 0; i < 17; i++) {
      const b = gp.buttons[i];
      down.push(!!b && (b.pressed || b.value > 0.5));
    }
    const pressed = down.map((d, i) => d && !this.prev[i]);
    const released = down.map((d, i) => !d && this.prev[i]);
    this.prev = down;
    const [lx, ly] = applyDeadzone(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
    const [rx, ry] = applyDeadzone(gp.axes[2] ?? 0, gp.axes[3] ?? 0, 0.14, 1.8);
    const lt = gp.buttons[PB.LT]?.value ?? 0;
    const rt = gp.buttons[PB.RT]?.value ?? 0;
    const anyInput = down.some(Boolean) || Math.hypot(lx, ly) > 0 || Math.hypot(rx, ry) > 0;
    if (anyInput) this.active = true;
    this.state = { connected: true, type, name: gp.id, lx, ly: -ly, rx, ry, down, pressed, released, lt, rt };
    return this.state;
  }

  /** Short rumble (silently ignored if unsupported or disabled). */
  rumble(strong: number, weak: number, ms: number): void {
    if (!this.vibration || this.index < 0) return;
    try {
      const gp = navigator.getGamepads?.()[this.index] as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
      void gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch?.(() => undefined);
    } catch {
      /* unsupported */
    }
  }
}

export const gamepad = new GamepadManager();
