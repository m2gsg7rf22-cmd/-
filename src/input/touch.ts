import type { InputManager } from './input';

/**
 * Multitouch controls: floating joystick (left), look area (right / anywhere free),
 * and action buttons. Each control tracks its own pointerId so move + look + jump work together.
 */
export class TouchControls {
  private root: HTMLElement;
  private joyBase: HTMLElement;
  private joyKnob: HTMLElement;
  private joyId = -1;
  private joyOrigin = { x: 0, y: 0 };
  private lookIds = new Map<number, { x: number; y: number }>();
  private cleanup: (() => void)[] = [];

  constructor(root: HTMLElement, private input: InputManager) {
    this.root = root;
    this.joyBase = root.querySelector('.joy-base') as HTMLElement;
    this.joyKnob = root.querySelector('.joy-knob') as HTMLElement;
    const zone = root.querySelector('.touch-zone') as HTMLElement;

    this.listen(zone, 'pointerdown', (e) => this.zoneDown(e));
    this.listen(window, 'pointermove', (e) => this.move(e));
    this.listen(window, 'pointerup', (e) => this.up(e));
    this.listen(window, 'pointercancel', (e) => this.up(e));

    this.bindHold('[data-touch="jump"]', (v) => (input.touchJump = v));
    this.bindHold('[data-touch="descend"]', (v) => (input.touchDescend = v));
    this.bindHold('[data-touch="mine"]', (v) => input.setTouchPrimary(v));
    this.bindHold('[data-touch="place"]', (v) => input.setTouchSecondary(v));
    this.bindTap('[data-touch="inventory"]', () => input.triggerEvent('inventory'));
    this.bindTap('[data-touch="pause"]', () => input.triggerEvent('pause'));
    this.bindTap('[data-touch="fly"]', () => input.triggerEvent('toggleFly'));
  }

  private listen(t: EventTarget, type: string, fn: (e: PointerEvent) => void): void {
    const h = (e: Event) => fn(e as PointerEvent);
    t.addEventListener(type, h);
    this.cleanup.push(() => t.removeEventListener(type, h));
  }

  /** Hold buttons: active while a finger is down on them; released on up/cancel/leave. */
  private bindHold(sel: string, set: (v: boolean) => void): void {
    const el = this.root.querySelector(sel) as HTMLElement | null;
    if (!el) return;
    let id = -1;
    const release = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      el.classList.remove('pressed');
      set(false);
    };
    this.listen(el, 'pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (id !== -1) return;
      id = e.pointerId;
      el.classList.add('pressed');
      set(true);
    });
    this.listen(el, 'pointerup', release);
    this.listen(el, 'pointercancel', release);
    this.listen(el, 'pointerleave', release);
    this.listen(window, 'pointerup', release);
    this.listen(window, 'pointercancel', release);
    this.cleanup.push(() => set(false));
  }

  private bindTap(sel: string, fn: () => void): void {
    const el = this.root.querySelector(sel) as HTMLElement | null;
    if (!el) return;
    this.listen(el, 'pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('pressed');
    });
    const off = () => el.classList.remove('pressed');
    this.listen(el, 'pointerleave', off);
    this.listen(el, 'pointercancel', off);
    this.listen(el, 'pointerup', (e) => {
      e.preventDefault();
      if (!el.classList.contains('pressed')) return;
      off();
      fn();
    });
  }

  private zoneDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    const w = window.innerWidth;
    // Left ~40% of the screen spawns the joystick; elsewhere is camera look.
    if (e.clientX < w * 0.4 && this.joyId === -1) {
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyBase.style.left = `${e.clientX}px`;
      this.joyBase.style.top = `${e.clientY}px`;
      this.joyBase.classList.add('active');
      this.joyKnob.style.transform = 'translate(-50%, -50%)';
    } else {
      this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  }

  private move(e: PointerEvent): void {
    if (e.pointerId === this.joyId) {
      const radius = Math.max(40, Math.min(70, window.innerHeight * 0.11));
      let dx = e.clientX - this.joyOrigin.x;
      let dy = e.clientY - this.joyOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx = (dx / len) * radius;
        dy = (dy / len) * radius;
      }
      this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const nx = dx / radius;
      const ny = -dy / radius; // screen up = forward
      const mag = Math.hypot(nx, ny);
      const dead = 0.12;
      const k = mag < dead ? 0 : (mag - dead) / (1 - dead) / mag;
      this.input.setTouchMove(nx * k, ny * k, mag > 0.95 && ny > 0.6);
      return;
    }
    const l = this.lookIds.get(e.pointerId);
    if (l) {
      const dx = e.clientX - l.x;
      const dy = e.clientY - l.y;
      l.x = e.clientX;
      l.y = e.clientY;
      this.input.addTouchLook(dx, dy);
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.joyId) {
      this.joyId = -1;
      this.joyBase.classList.remove('active');
      this.input.setTouchMove(0, 0, false);
    }
    this.lookIds.delete(e.pointerId);
  }

  /** Reset all touches (UI opened, orientation change, etc.). */
  reset(): void {
    this.joyId = -1;
    this.joyBase.classList.remove('active');
    this.lookIds.clear();
    this.input.setTouchMove(0, 0, false);
    this.root.querySelectorAll('.pressed').forEach((el) => el.classList.remove('pressed'));
  }

  dispose(): void {
    for (const c of this.cleanup) c();
    this.cleanup = [];
  }
}
