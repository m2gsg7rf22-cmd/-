// Action-mapped input: keyboard, mouse (+pointer lock), gamepad, touch joystick,
// rebinding, and virtual input injection for automated playtests.
export const DEFAULT_BINDINGS = {
  moveForward: ['KeyW', 'ArrowUp'], moveBack: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'], moveRight: ['KeyD', 'ArrowRight'],
  jump: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC', 'ControlLeft'],
  interact: ['KeyE'], attack: ['Mouse0', 'KeyJ'], heavy: ['Mouse2', 'KeyK'], block: ['KeyQ'],
  dodge: ['AltLeft', 'KeyL'], lockOn: ['Tab'], ability: ['KeyF'], reload: ['KeyT'],
  pause: ['Escape', 'KeyP'], map: ['KeyM'], journal: ['KeyJ'], camera: ['KeyV'],
  accelerate: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'], handbrake: ['Space'], boost: ['ShiftLeft'], horn: ['KeyH'],
  swing: ['KeyR', 'Mouse1'], glide: ['Space'],
  confirm: ['Enter', 'Space'], back: ['Escape', 'Backspace'],
  choice1: ['Digit1'], choice2: ['Digit2'], choice3: ['Digit3'], choice4: ['Digit4'],
};
// Standard gamepad mapping (buttons) -> actions
const PAD_BUTTONS = { 0: ['jump', 'confirm', 'handbrake', 'glide'], 1: ['dodge', 'back'], 2: ['attack', 'interact'], 3: ['heavy'],
  4: ['block'], 5: ['lockOn', 'swing'], 6: ['brake'], 7: ['accelerate'], 9: ['pause'], 10: ['sprint', 'boost'] };

export class Input {
  constructor(target = typeof window !== 'undefined' ? window : null, bindings = DEFAULT_BINDINGS) {
    this.bindings = JSON.parse(JSON.stringify(bindings));
    this.down = new Set();        // physical codes held
    this.pressedThisFrame = new Set();
    this.virtual = new Map();     // action -> value (tests / touch)
    this.virtualPressed = new Set();
    this.mouseDelta = { x: 0, y: 0 };
    this.wheel = 0;
    this.axesCache = {};
    this.padState = { buttons: [], axes: [0, 0, 0, 0] };
    this.sensitivity = 1;
    this.invertY = false;
    this.pointerLocked = false;
    this.enabled = true;
    this.listening = null; // rebinding callback
    this.target = target;
    if (target && target.addEventListener) this._attach(target);
  }
  _attach(t) {
    t.addEventListener('keydown', (e) => {
      if (this.listening) { e.preventDefault(); const cb = this.listening; this.listening = null; cb(e.code); return; }
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
    });
    t.addEventListener('keyup', (e) => this.down.delete(e.code));
    t.addEventListener('blur', () => this.down.clear());
    t.addEventListener('mousedown', (e) => {
      const c = 'Mouse' + e.button;
      if (!this.down.has(c)) this.pressedThisFrame.add(c);
      this.down.add(c);
    });
    t.addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    t.addEventListener('contextmenu', (e) => e.preventDefault());
    t.addEventListener('mousemove', (e) => {
      if (this.pointerLocked || (e.buttons & 1 && !this.requirePointerLock)) {
        this.mouseDelta.x += e.movementX || 0;
        this.mouseDelta.y += e.movementY || 0;
      }
    });
    t.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    if (typeof document !== 'undefined') {
      document.addEventListener('pointerlockchange', () => { this.pointerLocked = !!document.pointerLockElement; });
    }
  }
  requestPointerLock(el) { try { el.requestPointerLock?.(); } catch { /* ignore */ } }
  bind(action, codes) { this.bindings[action] = codes; }
  rebind(action, index = 0) {
    return new Promise((res) => { this.listening = (code) => { const arr = this.bindings[action] || []; arr[index] = code; this.bindings[action] = arr; res(code); }; });
  }
  _pad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }
  pollGamepad() {
    const p = this._pad();
    if (!p) { this.padState = { buttons: [], axes: [0, 0, 0, 0] }; return; }
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    const prev = this.padState.buttons;
    const buttons = p.buttons.map((b) => b.pressed || b.value > 0.5);
    this.padJustPressed = buttons.map((b, i) => b && !prev[i]);
    this.padState = { buttons, values: p.buttons.map((b) => b.value), axes: p.axes.map(dz) };
  }
  _padAction(action) {
    for (const [idx, acts] of Object.entries(PAD_BUTTONS)) {
      if (acts.includes(action)) {
        const i = +idx;
        if (this.padState.values && (i === 6 || i === 7)) { if (this.padState.values[i] > 0.05) return this.padState.values[i]; }
        else if (this.padState.buttons[i]) return 1;
      }
    }
    const ax = this.padState.axes;
    switch (action) {
      case 'moveForward': return Math.max(0, -ax[1] || 0);
      case 'moveBack': return Math.max(0, ax[1] || 0);
      case 'moveLeft': case 'steerLeft': return Math.max(0, -ax[0] || 0);
      case 'moveRight': case 'steerRight': return Math.max(0, ax[0] || 0);
    }
    return 0;
  }
  value(action) {
    if (!this.enabled) return 0;
    if (this.virtual.has(action)) return this.virtual.get(action);
    for (const c of this.bindings[action] || []) if (this.down.has(c)) return 1;
    return this._padAction(action);
  }
  held(action) { return this.value(action) > 0.5; }
  pressed(action) {
    if (!this.enabled) return false;
    if (this.virtualPressed.has(action)) return true;
    for (const c of this.bindings[action] || []) if (this.pressedThisFrame.has(c)) return true;
    if (this.padJustPressed) {
      for (const [idx, acts] of Object.entries(PAD_BUTTONS)) if (acts.includes(action) && this.padJustPressed[+idx]) return true;
    }
    return false;
  }
  // Movement vector in local space: x = right, y = forward. Length clamped to 1.
  moveVector() {
    let x = this.value('moveRight') - this.value('moveLeft');
    let y = this.value('moveForward') - this.value('moveBack');
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  look() {
    const ax = this.padState.axes;
    const s = this.sensitivity;
    const out = { x: this.mouseDelta.x * 0.0025 * s + (ax[2] || 0) * 0.05 * s, y: this.mouseDelta.y * 0.0025 * s + (ax[3] || 0) * 0.04 * s };
    if (this.invertY) out.y = -out.y;
    if (this.virtual.has('lookX')) out.x += this.virtual.get('lookX');
    if (this.virtual.has('lookY')) out.y += this.virtual.get('lookY');
    return out;
  }
  // Call at end of each simulation step.
  endFrame() {
    this.pressedThisFrame.clear();
    this.virtualPressed.clear();
    this.mouseDelta.x = 0; this.mouseDelta.y = 0; this.wheel = 0;
    if (this.padJustPressed) this.padJustPressed = this.padJustPressed.map(() => false);
  }
  // --- virtual input (tests, touch controls, AI demo replays) ---
  setVirtual(action, v) { if (v === null || v === undefined || v === 0) this.virtual.delete(action); else this.virtual.set(action, v); }
  tap(action) { this.virtualPressed.add(action); }
  clearVirtual() { this.virtual.clear(); this.virtualPressed.clear(); }
  describe(action) {
    const c = (this.bindings[action] || [])[0] || '?';
    return c.replace(/^Key/, '').replace(/^Digit/, '').replace('Mouse0', 'LMB').replace('Mouse2', 'RMB').replace('Mouse1', 'MMB').replace('ShiftLeft', 'Shift').replace('AltLeft', 'Alt').replace('ControlLeft', 'Ctrl');
  }
}

// On-screen touch controls: left virtual stick + action buttons, feeding Input.setVirtual.
export function createTouchControls(input, container, buttons = [['attack', 'A'], ['jump', 'J'], ['interact', 'E']]) {
  if (typeof window === 'undefined' || !('ontouchstart' in window)) return null;
  const root = document.createElement('div');
  root.className = 'gf-touch';
  root.innerHTML = `<div class="gf-stick"><div class="gf-knob"></div></div><div class="gf-touch-btns"></div>`;
  container.appendChild(root);
  const stick = root.querySelector('.gf-stick'), knob = root.querySelector('.gf-knob');
  let id = null, cx = 0, cy = 0;
  stick.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; id = t.identifier; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; e.preventDefault(); });
  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === id) {
      let dx = (t.clientX - cx) / 50, dy = (t.clientY - cy) / 50;
      const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
      input.setVirtual('moveRight', Math.max(0, dx)); input.setVirtual('moveLeft', Math.max(0, -dx));
      input.setVirtual('moveForward', Math.max(0, -dy)); input.setVirtual('moveBack', Math.max(0, dy));
      input.setVirtual('steerRight', Math.max(0, dx)); input.setVirtual('steerLeft', Math.max(0, -dx));
      input.setVirtual('accelerate', Math.max(0, -dy)); input.setVirtual('brake', Math.max(0, dy));
    }
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) if (t.identifier === id) {
      id = null; knob.style.transform = '';
      for (const a of ['moveRight', 'moveLeft', 'moveForward', 'moveBack', 'steerLeft', 'steerRight', 'accelerate', 'brake']) input.setVirtual(a, 0);
    }
  });
  const btns = root.querySelector('.gf-touch-btns');
  for (const [action, label] of buttons) {
    const b = document.createElement('button'); b.textContent = label;
    b.addEventListener('touchstart', (e) => { e.preventDefault(); input.tap(action); input.setVirtual(action, 1); });
    b.addEventListener('touchend', () => input.setVirtual(action, 0));
    btns.appendChild(b);
  }
  return root;
}
