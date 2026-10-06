import { PB, type PadSnapshot } from './gamepad';

/**
 * Central input ownership. All gameplay input (keyboard, mouse, pointer lock, touch, gamepad)
 * flows through here; UI code only toggles `gameplay` and listens to semantic events.
 */

export type InputEvent =
  | 'inventory'
  | 'pause'
  | 'toggleFly'
  | 'toggleDebug'
  | 'drop'
  | 'primaryDown'
  | 'secondaryDown'
  | 'pointerLockLost';

type Listener = (e: InputEvent) => void;

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'KeyC',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE', 'KeyF', 'KeyQ', 'F3', 'Tab',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
]);

export class InputManager {
  /** Gameplay input active (false while menus/inventory are open). */
  private _gameplay = false;
  private keys = new Set<string>();
  private listeners: Listener[] = [];
  private cleanup: (() => void)[] = [];

  // Accumulated look delta in "mouse pixels" (consumed each frame).
  private lookX = 0;
  private lookY = 0;
  private touchLookX = 0;
  private touchLookY = 0;

  // Touch/gamepad analog movement (-1..1).
  touchMove = { x: 0, y: 0 };
  private touchSprint = false;
  touchJump = false;
  touchDescend = false;
  private touchPrimary = false;
  private touchSecondary = false;

  private mousePrimary = false;
  private mouseSecondary = false;
  private wheel = 0;
  private hotbarPick = -1;

  private pad = { x: 0, y: 0, lx: 0, ly: 0, jump: false, primary: false, secondary: false, sprint: false, descend: false };

  pointerLocked = false;
  private lockErrors = 0;
  pointerLockSupported: boolean;
  /** Drag-to-look fallback state (when pointer lock is unavailable/denied). */
  private drag: { id: number; x: number; y: number; moved: number; t: number; holdTimer: number } | null = null;
  useDragFallback = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.pointerLockSupported = 'requestPointerLock' in canvas;
    this.on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.on(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.on(window, 'blur', () => this.releaseAll());
    this.on(document, 'visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    this.on(document, 'pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) this.lockErrors = 0;
      if (this.pointerLocked && !locked) {
        this.releaseAll();
        this.emit('pointerLockLost');
      }
      this.pointerLocked = locked;
    });
    this.on(document, 'pointerlockerror', () => {
      // Browsers briefly refuse re-locking right after Esc; only fall back after repeated denials.
      this.lockErrors++;
      if (this.lockErrors >= 3 && !this.useDragFallback) {
        console.warn('[BlockForge] pointer lock repeatedly denied; using drag-to-look');
        this.useDragFallback = true;
      }
    });
    this.on(document, 'mousemove', (e) => {
      const me = e as MouseEvent;
      if (!this._gameplay || !this.pointerLocked) return;
      // Ignore absurd spikes some browsers emit when locking.
      if (Math.abs(me.movementX) > 400 || Math.abs(me.movementY) > 400) return;
      this.lookX += me.movementX;
      this.lookY += me.movementY;
    });
    this.on(canvas, 'mousedown', (e) => this.onMouseDown(e as MouseEvent));
    this.on(window, 'mouseup', (e) => {
      const me = e as MouseEvent;
      if (me.button === 0) this.mousePrimary = false;
      if (me.button === 2) this.mouseSecondary = false;
    });
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(canvas, 'wheel', (e) => {
      const we = e as WheelEvent;
      if (!this._gameplay) return;
      we.preventDefault();
      this.wheel += Math.sign(we.deltaY);
    }, { passive: false });
    // Drag-look fallback for mouse when pointer lock isn't available.
    this.on(canvas, 'pointerdown', (e) => this.onDragStart(e as PointerEvent));
    this.on(window, 'pointermove', (e) => this.onDragMove(e as PointerEvent));
    this.on(window, 'pointerup', (e) => this.onDragEnd(e as PointerEvent));
    this.on(window, 'pointercancel', (e) => this.onDragEnd(e as PointerEvent));
  }

  private on(t: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
    t.addEventListener(type, fn, opts);
    this.cleanup.push(() => t.removeEventListener(type, fn, opts));
  }

  onEvent(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(e: InputEvent): void {
    for (const l of this.listeners) l(e);
  }

  get gameplay(): boolean {
    return this._gameplay;
  }

  set gameplay(v: boolean) {
    if (this._gameplay === v) return;
    this._gameplay = v;
    if (!v) this.releaseAll();
  }

  /** Clear every held state (focus loss, UI open, pointer lock lost…). */
  releaseAll(): void {
    this.keys.clear();
    this.mousePrimary = false;
    this.mouseSecondary = false;
    this.touchMove.x = 0;
    this.touchMove.y = 0;
    this.touchSprint = false;
    this.touchJump = false;
    this.touchDescend = false;
    this.touchPrimary = false;
    this.touchSecondary = false;
    this.lookX = 0;
    this.lookY = 0;
    this.touchLookX = 0;
    this.touchLookY = 0;
    if (this.drag) {
      clearTimeout(this.drag.holdTimer);
      this.drag = null;
    }
  }

  requestPointerLock(): void {
    if (!this.pointerLockSupported || this.useDragFallback) return;
    try {
      const r = (this.canvas.requestPointerLock as (o?: unknown) => Promise<void> | void).call(this.canvas, { unadjustedMovement: false });
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => {
          // Retry without options (older browsers), else fall back to dragging.
          try {
            const r2 = this.canvas.requestPointerLock() as unknown;
            if (r2 && typeof (r2 as Promise<void>).catch === 'function') (r2 as Promise<void>).catch(() => undefined);
          } catch {
            /* counted via pointerlockerror */
          }
        });
      }
    } catch {
      this.useDragFallback = true;
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const code = e.code;
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) {
      if (down && code === 'Escape') this.emit('pause');
      return;
    }
    if (down && (code === 'Escape' || code === 'KeyP') && !e.repeat) {
      // Escape exits pointer lock natively; we still emit pause.
      this.emit('pause');
      return;
    }
    if (down && code === 'KeyE' && !e.repeat) {
      e.preventDefault();
      this.emit('inventory');
      return;
    }
    if (!this._gameplay) return;
    if (GAME_KEYS.has(code)) e.preventDefault();
    if (down) {
      if (e.repeat) return;
      this.keys.add(code);
      if (code.startsWith('Digit')) {
        const n = parseInt(code.slice(5), 10);
        if (n >= 1 && n <= 9) this.hotbarPick = n - 1;
      }
      if (code === 'KeyF') this.emit('toggleFly');
      if (code === 'F3') this.emit('toggleDebug');
      if (code === 'KeyQ') this.emit('drop');
    } else {
      this.keys.delete(code);
    }
  }

  private onMouseDown(e: MouseEvent): void {
    if (!this._gameplay) return;
    if (this.useDragFallback || !this.pointerLockSupported) return; // handled by drag logic
    if (!this.pointerLocked) {
      this.requestPointerLock();
      return;
    }
    if (e.button === 0) {
      this.mousePrimary = true;
      this.emit('primaryDown');
    } else if (e.button === 2) {
      this.mouseSecondary = true;
      this.emit('secondaryDown');
    }
  }

  private onDragStart(e: PointerEvent): void {
    if (e.pointerType !== 'mouse' || !this._gameplay) return;
    if (!(this.useDragFallback || !this.pointerLockSupported)) return;
    if (e.button === 2) {
      this.mouseSecondary = true;
      this.emit('secondaryDown');
      return;
    }
    if (e.button !== 0) return;
    const d = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), holdTimer: 0 };
    // Holding still for 220ms starts mining; moving first means "look".
    d.holdTimer = window.setTimeout(() => {
      if (this.drag === d && d.moved < 6) {
        this.mousePrimary = true;
        this.emit('primaryDown');
      }
    }, 220);
    this.drag = d;
  }

  private onDragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    d.moved += Math.abs(dx) + Math.abs(dy);
    if (!this.mousePrimary) {
      this.lookX += dx;
      this.lookY += dy;
    }
  }

  private onDragEnd(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button === 2) this.mouseSecondary = false;
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    clearTimeout(d.holdTimer);
    this.drag = null;
    this.mousePrimary = false;
  }

  // ---- touch API (called by TouchControls) ----

  addTouchLook(dx: number, dy: number): void {
    if (!this._gameplay) return;
    this.touchLookX += dx;
    this.touchLookY += dy;
  }

  setTouchMove(x: number, y: number, sprint: boolean): void {
    this.touchMove.x = x;
    this.touchMove.y = y;
    this.touchSprint = sprint;
  }

  setTouchPrimary(v: boolean): void {
    if (v && !this.touchPrimary && this._gameplay) this.emit('primaryDown');
    this.touchPrimary = v && this._gameplay;
  }

  setTouchSecondary(v: boolean): void {
    if (v && !this.touchSecondary && this._gameplay) this.emit('secondaryDown');
    this.touchSecondary = v && this._gameplay;
  }

  triggerEvent(e: InputEvent): void {
    this.emit(e);
  }

  // ---- per-frame queries ----

  /**
   * Apply this frame's gamepad snapshot (polled once per frame by the app).
   * Buttons held from before gameplay started (e.g. the A press that closed a menu)
   * are ignored until released, so they don't leak into the game.
   */
  applyPad(s: PadSnapshot): void {
    const P = this.pad;
    if (!s.connected) {
      P.x = P.y = P.lx = P.ly = 0;
      P.jump = P.primary = P.secondary = P.sprint = P.descend = false;
      this.padBlocked.fill(false);
      return;
    }
    if (this._gameplay && !this.padWasGameplay) {
      for (let i = 0; i < s.down.length; i++) this.padBlocked[i] = s.down[i];
    }
    this.padWasGameplay = this._gameplay;
    for (let i = 0; i < s.down.length; i++) if (!s.down[i]) this.padBlocked[i] = false;
    const held = (i: number) => s.down[i] && !this.padBlocked[i];
    const hit = (i: number) => s.pressed[i] && !this.padBlocked[i];

    // Menu-level buttons work in and out of gameplay.
    if (s.pressed[PB.START]) this.emit('pause');
    if (s.pressed[PB.NORTH] && (this._gameplay || this.padInventoryOpen)) this.emit('inventory');
    if (!this._gameplay) {
      P.x = P.y = P.lx = P.ly = 0;
      P.jump = P.primary = P.secondary = P.sprint = P.descend = false;
      return;
    }
    P.x = s.lx;
    P.y = s.ly;
    P.lx = s.rx;
    P.ly = s.ry;
    P.jump = held(PB.SOUTH);
    P.descend = held(PB.EAST);
    P.primary = held(PB.RT);
    P.secondary = held(PB.LT);
    if (hit(PB.RT)) this.emit('primaryDown');
    if (hit(PB.LT)) this.emit('secondaryDown');
    if (hit(PB.RB) || hit(PB.RIGHT)) this.hotbarPick = -2;
    if (hit(PB.LB) || hit(PB.LEFT)) this.hotbarPick = -3;
    if (hit(PB.WEST)) this.emit('drop');
    if (hit(PB.UP)) this.emit('toggleFly');
    // Click the left stick to sprint; it stays on until you stop moving.
    if (hit(PB.L3)) this.padSprintLatch = !this.padSprintLatch;
    if (Math.hypot(s.lx, s.ly) < 0.3) this.padSprintLatch = false;
    P.sprint = this.padSprintLatch;
  }

  /** Set by the app while the inventory is open, so the inventory button also closes it. */
  padInventoryOpen = false;
  private padBlocked: boolean[] = new Array(17).fill(false);
  private padWasGameplay = false;
  private padSprintLatch = false;
  padSens = 1;

  /** Movement input: x = strafe right, y = forward. Magnitude ≤ 1. */
  moveVector(): { x: number; y: number } {
    if (!this._gameplay) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    x += this.touchMove.x + this.pad.x;
    y += this.touchMove.y + this.pad.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  get jump(): boolean {
    return this._gameplay && (this.keys.has('Space') || this.touchJump || this.pad.jump);
  }

  get sprint(): boolean {
    return this._gameplay && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSprint || this.pad.sprint);
  }

  get descend(): boolean {
    return this._gameplay && (this.keys.has('ControlLeft') || this.keys.has('KeyC') || this.touchDescend || this.pad.descend);
  }

  get primary(): boolean {
    return this._gameplay && (this.mousePrimary || this.touchPrimary || this.pad.primary);
  }

  get secondary(): boolean {
    return this._gameplay && (this.mouseSecondary || this.touchSecondary || this.pad.secondary);
  }

  /** Consume accumulated look delta as radians (yaw, pitch). Positive dy = look down. */
  consumeLook(dt: number, mouseSens: number, touchSens: number, invertY: boolean): { dx: number; dy: number } {
    const M = 0.0022 * mouseSens;
    const T = 0.0055 * touchSens;
    const dx = this.lookX * M + this.touchLookX * T + this.pad.lx * 3.2 * this.padSens * dt;
    let dy = this.lookY * M + this.touchLookY * T + this.pad.ly * 2.4 * this.padSens * dt;
    if (invertY) dy = -dy;
    this.lookX = this.lookY = this.touchLookX = this.touchLookY = 0;
    return { dx, dy };
  }

  /** Hotbar change requested: >=0 slot index; returns wheel delta separately. */
  consumeHotbar(): { pick: number; wheel: number } {
    let pick = this.hotbarPick;
    let wheel = this.wheel;
    if (pick === -2) { wheel += 1; pick = -1; }
    if (pick === -3) { wheel -= 1; pick = -1; }
    this.hotbarPick = -1;
    this.wheel = 0;
    return { pick, wheel };
  }

  dispose(): void {
    for (const c of this.cleanup) c();
    this.cleanup = [];
    this.listeners = [];
  }
}
