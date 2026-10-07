import { audio } from '../audio/audio';
import { applyPreset, type Settings } from '../game/settings';
import type { WorldMeta } from '../save/serialize';
import { TerrainGenerator } from '../world/generator';
import { SEA_LEVEL } from '../core/constants';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

/** Wire click handlers by data-act attribute. Plays a UI click. */
export function actions(root: HTMLElement, map: Record<string, (btn: HTMLElement) => void>): void {
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!b || (b as HTMLButtonElement).disabled) return;
    const fn = map[b.dataset.act!];
    if (fn) {
      audio.unlock();
      audio.click();
      fn(b);
    }
  });
}

// ---------------- animated menu background ----------------

export class MenuBackground {
  private canvas: HTMLCanvasElement;
  private raf = 0;
  private offset = 0;
  private gen = new TerrainGenerator(20251005);
  private heights = new Map<number, number>();
  private last = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'menu-bg';
    parent.prepend(this.canvas);
    this.start();
  }

  private h(x: number): number {
    let v = this.heights.get(x);
    if (v === undefined) {
      v = this.gen.column(x, 37).height;
      this.heights.set(x, v);
      if (this.heights.size > 2000) this.heights.clear();
    }
    return v;
  }

  private start(): void {
    const draw = (t: number) => {
      this.raf = requestAnimationFrame(draw);
      const dt = Math.min(0.1, (t - (this.last || t)) / 1000);
      this.last = t;
      this.offset += dt * 4;
      const W = 240;
      const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
      const H = Math.max(90, Math.round(W / Math.max(0.5, aspect)));
      if (this.canvas.width !== W || this.canvas.height !== H) {
        this.canvas.width = W;
        this.canvas.height = H;
      }
      const ctx = this.canvas.getContext('2d')!;
      ctx.clearRect(0, 0, W, H);
      const base = H * 0.95;
      const layer = (scroll: number, scale: number, colors: [string, string, string], shift: number, sea: boolean) => {
        const ox = Math.floor(this.offset * scroll);
        for (let x = 0; x < W; x++) {
          const wx = x + ox + shift;
          const hh = this.h(wx);
          const y = Math.round(base - (hh - 30) * scale);
          const seaY = Math.round(base - (SEA_LEVEL - 30) * scale);
          ctx.fillStyle = colors[2];
          ctx.fillRect(x, y + 4, 1, H - y);
          ctx.fillStyle = colors[1];
          ctx.fillRect(x, y + 1, 1, 3);
          ctx.fillStyle = hh > 90 ? '#eef3f8' : hh <= SEA_LEVEL + 1 ? '#d8c690' : colors[0];
          ctx.fillRect(x, y, 1, 1);
          if (sea && y > seaY) {
            ctx.fillStyle = 'rgba(46,104,180,0.85)';
            ctx.fillRect(x, seaY, 1, y - seaY);
          }
          if (sea && hh > SEA_LEVEL + 2 && hh < 88 && (wx * 2654435761) % 23 === 0) {
            ctx.fillStyle = '#5c4630';
            ctx.fillRect(x, y - 5, 1, 5);
            ctx.fillStyle = '#3f7a3c';
            ctx.fillRect(x - 2, y - 9, 5, 4);
          }
        }
      };
      layer(0.35, 0.55, ['#7d9db8', '#6f8aa3', '#62788e'], 5000, false);
      layer(1, 0.8, ['#5fa045', '#7a5a3c', '#555a66'], 0, true);
    };
    this.raf = requestAnimationFrame(draw);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}

// ---------------- screens ----------------

export function mainMenu(hasWorlds: boolean, persistent: boolean): HTMLElement {
  return el(`
    <div class="screen menu" data-screen="menu">
      <div class="menu-inner">
        <div class="logo"><span class="l1">BLOCK</span><span class="l2">FORGE</span><span class="tag">Survive · Build · Explore</span></div>
        <div class="menu-buttons">
          <button class="btn primary" data-act="play">${hasWorlds ? 'Play' : 'Play — New World'}</button>
          <button class="btn" data-act="worlds">Worlds</button>
          <button class="btn" data-act="new">New World</button>
          <button class="btn" data-act="settings">Settings</button>
          <button class="btn ghost" data-act="exit">Exit Game</button>
        </div>
      </div>
      <div class="menu-foot"><span>v0.1 · original voxel sandbox</span><span>${persistent ? '' : 'Storage unavailable — worlds won’t persist'}</span></div>
    </div>`);
}

export function newWorldScreen(): HTMLElement {
  const n = Math.floor(Math.random() * 900) + 100;
  const s = el(`
    <div class="screen solid" data-screen="new">
      <div class="panel">
        <h2>New World</h2>
        <div class="stack scroll">
          <label class="field">World Name<input type="text" name="name" maxlength="32" value="World ${n}" autocomplete="off" spellcheck="false"></label>
          <label class="field">Seed <span class="muted small" style="text-transform:none;letter-spacing:0">(leave empty for random)</span><input type="text" name="seed" maxlength="32" placeholder="Random" autocomplete="off" spellcheck="false"></label>
          <div class="field" style="display:grid;gap:6px;font-size:.8rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">Game Mode
            <div class="seg-group">
              <button class="btn seg on" data-act="mode" data-mode="survival">Survival</button>
              <button class="btn seg" data-act="mode" data-mode="creative">Creative</button>
            </div>
            <span class="mode-desc small muted" style="text-transform:none;letter-spacing:0">Gather resources, craft tools, stay fed and survive the night.</span>
          </div>
        </div>
        <div class="row end" style="margin-top:18px">
          <button class="btn ghost" data-act="back">Back</button>
          <button class="btn primary" data-act="create">Create World</button>
        </div>
      </div>
    </div>`);
  return s;
}

export function worldsScreen(worlds: WorldMeta[]): HTMLElement {
  const items = worlds.length
    ? worlds
        .map((w) => {
          const d = new Date(w.lastPlayed);
          return `<div class="world-item" data-id="${esc(w.id)}">
            <div><div class="title">${esc(w.name)}<span class="badge ${w.mode}">${w.mode.toUpperCase()}</span></div>
            <div class="meta">Seed ${esc(w.seed)} · Last played ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div>
            <div class="row"><button class="btn small primary" data-act="playw">Play</button><button class="btn small" data-act="rename">Rename</button><button class="btn small danger" data-act="delete">Delete</button></div>
          </div>`;
        })
        .join('')
    : `<div class="empty">No worlds yet. Forge your first one!</div>`;
  return el(`
    <div class="screen solid" data-screen="worlds">
      <div class="panel wide">
        <h2>Worlds</h2>
        <div class="world-list scroll">${items}</div>
        <div class="row end" style="margin-top:16px">
          <button class="btn ghost" data-act="back">Back</button>
          <button class="btn primary" data-act="new">New World</button>
        </div>
      </div>
    </div>`);
}

export function loadingScreen(): HTMLElement {
  return el(`
    <div class="screen loading" data-screen="loading">
      <div class="cube-spin"></div>
      <div class="stage">Preparing…</div>
      <div class="bar"><i></i></div>
      <div class="muted small" style="margin-top:12px" data-detail></div>
    </div>`);
}

/** Shown after "Exit Game" when the browser won't let the page close itself (e.g. embedded or not opened by script). */
export function goodbyeScreen(): HTMLElement {
  return el(`
    <div class="screen solid" data-screen="goodbye">
      <div class="panel" style="text-align:center">
        <h2>See you soon!</h2>
        <p>Your worlds are saved. You can close this tab or window now.</p>
        <div class="row" style="justify-content:center"><button class="btn primary" data-act="back">Back to the menu</button></div>
      </div>
    </div>`);
}

export function pauseScreen(creative = false): HTMLElement {
  return el(`
    <div class="screen dim" data-screen="pause">
      <div class="panel" style="width:min(380px,100%)">
        <h2 style="text-align:center">Paused</h2>
        <div class="stack">
          <button class="btn primary" data-act="resume">Resume</button>
          <button class="btn" data-act="settings">Settings</button>
          <button class="btn" data-act="mode">${creative ? 'Switch to Survival' : 'Switch to Creative'}</button>
          <button class="btn" data-act="fullscreen" ${document.fullscreenEnabled ? '' : 'hidden'}>Toggle Fullscreen</button>
          <button class="btn" data-act="savequit">Save &amp; Exit to Menu</button>
        </div>
      </div>
    </div>`);
}

export function deathScreen(reason: string): HTMLElement {
  return el(`
    <div class="screen death" data-screen="death">
      <h1>YOU FELL</h1>
      <p>${esc(reason)}</p>
      <div class="stack" style="width:min(320px,100%)">
        <button class="btn primary" data-act="respawn">Respawn</button>
        <button class="btn" data-act="menu">Main Menu</button>
      </div>
    </div>`);
}

export function rotateOverlay(): HTMLElement {
  return el(`
    <div class="screen rotate" data-screen="rotate">
      <div class="phone"></div>
      <h2>ROTATE YOUR DEVICE</h2>
      <p class="muted">Landscape mode recommended</p>
      <button class="btn ghost small" data-act="continue" style="margin-top:18px">Continue in portrait</button>
    </div>`);
}

export function confirmDialog(title: string, body: string, okLabel: string, danger = true): HTMLElement {
  return el(`
    <div class="screen dim confirm" data-screen="confirm">
      <div class="panel" style="width:min(420px,100%)">
        <h2>${esc(title)}</h2>
        <p class="muted" style="margin:0 0 18px">${esc(body)}</p>
        <div class="row end">
          <button class="btn ghost" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${esc(okLabel)}</button>
        </div>
      </div>
    </div>`);
}

export function promptDialog(title: string, value: string): HTMLElement {
  return el(`
    <div class="screen dim confirm" data-screen="prompt">
      <div class="panel" style="width:min(420px,100%)">
        <h2>${esc(title)}</h2>
        <input type="text" maxlength="32" value="${esc(value)}" autocomplete="off" spellcheck="false" style="width:100%">
        <div class="row end" style="margin-top:16px">
          <button class="btn ghost" data-act="cancel">Cancel</button>
          <button class="btn primary" data-act="ok">Save</button>
        </div>
      </div>
    </div>`);
}

export function errorScreen(title: string, msg: string): HTMLElement {
  return el(`
    <div class="screen solid" data-screen="error">
      <div class="panel">
        <h2>${esc(title)}</h2>
        <p class="muted">${esc(msg)}</p>
        <div class="row end"><button class="btn primary" data-act="reload">Reload</button></div>
      </div>
    </div>`);
}

// ---------------- settings ----------------

type SettingsTab = 'graphics' | 'controls' | 'audio' | 'interface';

export function settingsScreen(
  s: Settings,
  mobile: boolean,
  onChange: (s: Settings) => void,
  onBack: () => void,
): HTMLElement {
  let tab: SettingsTab = 'graphics';
  const root = el(`<div class="screen solid" data-screen="settings"><div class="panel wide"><h2>Settings</h2><div class="tabs"></div><div class="scroll body"></div><div class="row end" style="margin-top:14px"><button class="btn primary" data-act="back">Done</button></div></div></div>`);
  const tabsEl = root.querySelector('.tabs') as HTMLElement;
  const body = root.querySelector('.body') as HTMLElement;
  const maxRd = mobile ? 8 : 16;

  const row = (name: string, desc: string, control: string) =>
    `<div class="setting"><div><div class="name">${name}</div>${desc ? `<div class="desc">${desc}</div>` : ''}</div><div class="control">${control}</div></div>`;
  const toggle = (key: keyof Settings) => `<button class="toggle ${s[key] ? 'on' : ''}" role="switch" aria-checked="${!!s[key]}" data-toggle="${key}" aria-label="${key}"></button>`;
  const range = (key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) =>
    `<input type="range" data-range="${key}" min="${min}" max="${max}" step="${step}" value="${s[key] as number}" aria-label="${key}"><output>${fmt(s[key] as number)}</output>`;
  const seg = (key: keyof Settings, opts: [string, string][]) =>
    `<div class="seg-group">${opts.map(([v, l]) => `<button class="btn seg ${s[key] === v ? 'on' : ''}" data-seg="${key}" data-val="${v}">${l}</button>`).join('')}</div>`;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const fmts: Partial<Record<keyof Settings, (v: number) => string>> = {
    renderDistance: (v) => `${v}`,
    fov: (v) => `${Math.round(v)}°`,
    resolutionScale: pct,
    mouseSens: (v) => v.toFixed(2),
    touchSens: (v) => v.toFixed(2),
    padSens: (v) => v.toFixed(2),
    master: pct,
    effects: pct,
    ambient: pct,
    music: pct,
    uiScale: pct,
  };

  const render = () => {
    tabsEl.innerHTML = (['graphics', 'controls', 'audio', 'interface'] as SettingsTab[])
      .map((t) => `<button class="btn seg ${t === tab ? 'on' : ''}" data-tab="${t}">${t}</button>`)
      .join('');
    let h = '';
    if (tab === 'graphics') {
      h += row('Graphics Quality', 'Preset for render distance, effects and resolution', seg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']]));
      h += row('Render Distance', `Chunks in each direction${mobile ? ' (mobile max 8)' : ''}`, range('renderDistance', 3, maxRd, 1, fmts.renderDistance!));
      h += row('Ambient Occlusion', 'Soft voxel corner shading', toggle('ao'));
      h += row('Particles', '', seg('particles', [['off', 'Off'], ['low', 'Low'], ['high', 'High']]));
      h += row('Clouds', '', toggle('clouds'));
      h += row('Field of View', '', range('fov', 50, 110, 1, fmts.fov!));
      h += row('Resolution Scale', 'Lower = faster on weak GPUs', range('resolutionScale', 0.5, 1, 0.05, pct));
      h += row('Adaptive Quality', 'Lowers settings automatically if FPS stays low', toggle('adaptive'));
      h += row('Debug Overlay', 'FPS, coordinates, chunks (F3)', toggle('showDebug'));
    } else if (tab === 'controls') {
      h += row('Control Scheme', 'Auto detects touch vs mouse/keyboard', seg('deviceMode', [['auto', 'Auto'], ['desktop', 'Desktop'], ['mobile', 'Mobile']]));
      h += row('Mouse Sensitivity', '', range('mouseSens', 0.1, 3, 0.05, fmts.mouseSens!));
      h += row('Touch Sensitivity', '', range('touchSens', 0.1, 3, 0.05, fmts.touchSens!));
      h += row('Invert Y', '', toggle('invertY'));
      h += row('Auto-Jump', 'Hop up single blocks automatically', toggle('autoJump'));
      h += row('Controller Sensitivity', 'Right stick look speed (Xbox, PlayStation, Switch controllers)', range('padSens', 0.2, 3, 0.05, fmts.padSens!));
      h += row('Controller Vibration', '', toggle('vibration'));
      h += row('Button Prompts', 'Auto-detects the controller; override if needed', seg('padLayout', [['auto', 'Auto'], ['xbox', 'Xbox'], ['playstation', 'PlayStation'], ['nintendo', 'Nintendo']]));
    } else if (tab === 'audio') {
      h += row('Master Volume', '', range('master', 0, 1, 0.05, pct));
      h += row('Effects', '', range('effects', 0, 1, 0.05, pct));
      h += row('Ambient', 'Wind and wildlife', range('ambient', 0, 1, 0.05, pct));
      h += row('Music', 'Calm procedural music now and then', range('music', 0, 1, 0.05, pct));
    } else {
      h += row('UI Scale', '', range('uiScale', 0.75, 1.5, 0.05, pct));
      h += row('Compass & Minimap', '', toggle('showMap'));
      h += row('Block names', 'Name of the block or creature you aim at', toggle('showNames'));
      h += row('Reduced Motion', 'Disables view bobbing, FOV kick and UI animations', toggle('reducedMotion'));
      if (document.fullscreenEnabled) h += row('Fullscreen', '', `<button class="btn small" data-fs>Toggle</button>`);
    }
    body.innerHTML = h;
  };

  const commit = (next: Settings, rerender = false) => {
    s = next;
    onChange(s);
    if (rerender) render();
  };

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const tb = t.closest('[data-tab]') as HTMLElement | null;
    if (tb) {
      audio.click();
      tab = tb.dataset.tab as SettingsTab;
      render();
      return;
    }
    const tg = t.closest('[data-toggle]') as HTMLElement | null;
    if (tg) {
      audio.click();
      const k = tg.dataset.toggle as keyof Settings;
      commit({ ...s, [k]: !s[k] }, true);
      return;
    }
    const sg = t.closest('[data-seg]') as HTMLElement | null;
    if (sg) {
      audio.click();
      const k = sg.dataset.seg as keyof Settings;
      const v = sg.dataset.val!;
      if (k === 'quality') {
        const next = applyPreset(s, v as Settings['quality']);
        next.renderDistance = Math.min(next.renderDistance, maxRd);
        commit(next, true);
      } else commit({ ...s, [k]: v } as Settings, true);
      return;
    }
    if (t.closest('[data-fs]')) {
      audio.click();
      toggleFullscreen();
      return;
    }
    if (t.closest('[data-act="back"]')) {
      audio.click();
      onBack();
    }
  });
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const k = t.dataset.range as keyof Settings | undefined;
    if (!k) return;
    const v = Number(t.value);
    const out = t.nextElementSibling as HTMLOutputElement | null;
    const f = fmts[k] ?? ((x: number) => String(x));
    if (out) out.textContent = f(v);
    commit({ ...s, [k]: v });
  });
  render();
  return root;
}

export function toggleFullscreen(): void {
  try {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  } catch {
    /* unsupported */
  }
}
