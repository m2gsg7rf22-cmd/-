import { PB, type PadSnapshot } from '../input/gamepad';

export interface NavRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Spatial navigation: pick the rect best reached from `from` in direction (dx, dy).
 * Candidates must lie in that half-plane; distance along the direction is cheap,
 * sideways offset is penalized so moving "down" prefers the item right below.
 */
export function pickInDirection(from: NavRect, cands: NavRect[], dx: number, dy: number): number {
  let best = -1;
  let bestScore = Infinity;
  const fx0 = from.x, fx1 = from.x + from.w, fy0 = from.y, fy1 = from.y + from.h;
  cands.forEach((r, i) => {
    const x0 = r.x, x1 = r.x + r.w, y0 = r.y, y1 = r.y + r.h;
    // Gap between the facing edges along the direction (must be ahead of us).
    let along: number;
    let side: number;
    if (dy !== 0) {
      along = dy > 0 ? y0 - fy1 : fy0 - y1;
      side = Math.max(0, x0 - fx1, fx0 - x1); // 0 when the columns overlap
      if (dy > 0 ? y0 + r.h / 2 <= fy0 + from.h / 2 : y0 + r.h / 2 >= fy0 + from.h / 2) return;
    } else {
      along = dx > 0 ? x0 - fx1 : fx0 - x1;
      side = Math.max(0, y0 - fy1, fy0 - y1); // 0 when the rows overlap
      if (dx > 0 ? x0 + r.w / 2 <= fx0 + from.w / 2 : x0 + r.w / 2 >= fx0 + from.w / 2) return;
    }
    if (along < -4) return;
    // Prefer centers that line up when several candidates overlap.
    const cAlign = dy !== 0 ? Math.abs((x0 + x1) / 2 - (fx0 + fx1) / 2) : Math.abs((y0 + y1) / 2 - (fy0 + fy1) / 2);
    const score = Math.max(0, along) + side * 3 + cAlign * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const FOCUSABLE = [
  'button:not([disabled])', 'input', '.toggle', '[data-slot]', '[data-lib]', '[data-tab]', '[data-seg]', '[data-act]',
].join(',');

/** Stable identity for an element so focus survives re-renders (inventory, settings). */
function keyOf(el: HTMLElement): string {
  const d = el.dataset;
  return d.slot !== undefined ? `slot:${d.slot}` : d.lib ? `lib:${d.lib}` : d.craft ? `craft:${d.craft}` : d.tab ? `tab:${d.tab}`
    : d.seg ? `seg:${d.seg}:${d.val}` : d.toggle ? `toggle:${d.toggle}` : d.range ? `range:${d.range}` : d.act ? `act:${d.act}:${d.mode ?? ''}` : el.getAttribute('name') ?? '';
}

/** Gamepad-driven focus navigation over whatever screen is on top of #ui. */
export class PadNav {
  private focused: HTMLElement | null = null;
  private focusKey = '';
  private repeatDir = '';
  private repeatTimer = 0;

  constructor(private ui: HTMLElement) {}

  /** The topmost visible screen (dialogs/overlays sit above menus). */
  private container(): HTMLElement | null {
    const screens = [...this.ui.children].filter((c) => (c as HTMLElement).classList.contains('screen') && !(c as HTMLElement).hidden) as HTMLElement[];
    return screens[screens.length - 1] ?? null;
  }

  private candidates(root: HTMLElement): HTMLElement[] {
    return ([...root.querySelectorAll(FOCUSABLE)] as HTMLElement[]).filter((el) => {
      if (el.closest('[hidden]')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  private setFocus(el: HTMLElement | null): void {
    if (this.focused === el) return;
    this.focused?.classList.remove('pad-focus');
    this.focused = el;
    if (el) {
      el.classList.add('pad-focus');
      this.focusKey = keyOf(el);
      el.dispatchEvent(new Event('padfocus', { bubbles: true }));
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  clear(): void {
    this.focused?.classList.remove('pad-focus');
    this.focused = null;
    this.focusKey = '';
  }

  update(s: PadSnapshot, dt: number): void {
    const root = this.container();
    if (!root) return this.clear();
    const cands = this.candidates(root);
    if (!cands.length) return this.clear();
    // Re-acquire focus after re-renders, or pick a sensible default.
    if (!this.focused || !this.focused.isConnected || !root.contains(this.focused)) {
      const again = cands.find((c) => keyOf(c) === this.focusKey);
      this.focused = null;
      this.setFocus(again ?? (root.querySelector('.btn.primary:not([disabled])') as HTMLElement | null) ?? cands[0]);
    }
    const cur = this.focused!;

    // Direction from D-pad or left stick, with key-repeat.
    let dir = '';
    if (s.down[PB.UP] || s.ly > 0.6) dir = 'up';
    else if (s.down[PB.DOWN] || s.ly < -0.6) dir = 'down';
    else if (s.down[PB.LEFT] || s.lx < -0.6) dir = 'left';
    else if (s.down[PB.RIGHT] || s.lx > 0.6) dir = 'right';
    let step = false;
    if (dir !== this.repeatDir) {
      this.repeatDir = dir;
      this.repeatTimer = 0.38;
      step = dir !== '';
    } else if (dir) {
      this.repeatTimer -= dt;
      if (this.repeatTimer <= 0) {
        this.repeatTimer = 0.11;
        step = true;
      }
    }
    if (step) {
      const range = cur instanceof HTMLInputElement && cur.type === 'range' ? cur : null;
      if (range && (dir === 'left' || dir === 'right')) {
        const st = Number(range.step) || 1;
        const v = Math.min(Number(range.max), Math.max(Number(range.min), Number(range.value) + (dir === 'right' ? st : -st)));
        range.value = String(v);
        range.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const [dx, dy] = dir === 'up' ? [0, -1] : dir === 'down' ? [0, 1] : dir === 'left' ? [-1, 0] : [1, 0];
        const toNav = (b: DOMRect): NavRect => ({ x: b.left, y: b.top, w: b.width, h: b.height });
        const rects = cands.map((c) => toNav(c.getBoundingClientRect()));
        const r = toNav(cur.getBoundingClientRect());
        const others = cands.filter((c) => c !== cur);
        const i = pickInDirection(r, others.map((c) => rects[cands.indexOf(c)]), dx, dy);
        if (i >= 0) this.setFocus(others[i]);
      }
    }

    if (s.pressed[PB.SOUTH]) this.activate(cur);
    if (s.pressed[PB.EAST]) this.back(root);
    if (s.pressed[PB.WEST]) (root.querySelector('[data-act=split]') as HTMLElement | null)?.click();
    if (s.pressed[PB.LB] || s.pressed[PB.RB]) {
      const tabs = [...root.querySelectorAll('[data-tab]')] as HTMLElement[];
      if (tabs.length > 1) {
        const on = Math.max(0, tabs.findIndex((t) => t.classList.contains('on')));
        const next = tabs[(on + (s.pressed[PB.RB] ? 1 : -1) + tabs.length) % tabs.length];
        next.click();
        this.focusKey = keyOf(next);
        this.focused = null;
      }
    }
  }

  private activate(el: HTMLElement): void {
    if (el instanceof HTMLInputElement && el.type !== 'range') {
      el.focus(); // brings up the system/console on-screen keyboard
      return;
    }
    if (el.dataset.slot !== undefined) {
      // Inventory slots use pointer events (click-to-pick, click-to-place).
      const r = el.getBoundingClientRect();
      const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 99, button: 0 };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      return;
    }
    el.click();
  }

  private back(root: HTMLElement): void {
    const b = root.querySelector('[data-act=back], [data-act=close], [data-act=cancel], [data-act=resume], [data-act=continue]') as HTMLElement | null;
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    b?.click();
  }
}
