// DOM-based game UI kit: HUD widgets (bars, counters, objectives, prompts, minimap,
// compass, speedometer, damage numbers, boss bar), dialogue box with choices,
// subtitles, toasts, menus (title/pause/settings/game over/victory/loading) and
// accessibility (text scale, high contrast, colour filters, reduced motion, remapping).
const CSS = `
:root{--gf-accent:#4fd1ff;--gf-accent2:#ffb347;--gf-bg:rgba(10,14,22,.62);--gf-bg2:rgba(10,14,22,.85);--gf-text:#eef3f8;--gf-dim:#9fb0c3;--gf-danger:#ff4d5e;--gf-ok:#5dff9a;--gf-scale:1;--gf-font:'Segoe UI',system-ui,-apple-system,Roboto,sans-serif}
.gf-ui{position:fixed;inset:0;pointer-events:none;font-family:var(--gf-font);color:var(--gf-text);font-size:calc(15px*var(--gf-scale));user-select:none;z-index:10}
.gf-ui *{box-sizing:border-box}
.gf-panel{background:var(--gf-bg);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.08);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.gf-tl{position:absolute;left:20px;top:18px;display:flex;flex-direction:column;gap:8px}
.gf-tr{position:absolute;right:20px;top:18px;display:flex;flex-direction:column;gap:8px;align-items:flex-end}
.gf-bl{position:absolute;left:20px;bottom:20px;display:flex;flex-direction:column;gap:8px}
.gf-br{position:absolute;right:20px;bottom:20px;display:flex;flex-direction:column;gap:8px;align-items:flex-end}
.gf-bar{width:calc(260px*var(--gf-scale));padding:6px 10px}
.gf-bar label{display:flex;justify-content:space-between;font-size:.72em;letter-spacing:.12em;text-transform:uppercase;color:var(--gf-dim);margin-bottom:4px}
.gf-bar .t{height:9px;background:rgba(255,255,255,.08);border-radius:5px;overflow:hidden;position:relative}
.gf-bar .f,.gf-bar .g{position:absolute;inset:0;transform-origin:left;border-radius:5px;transition:transform .12s}
.gf-bar .g{background:rgba(255,255,255,.55);transition:transform .9s .25s}
.gf-counter{padding:6px 14px;font-weight:600;font-size:1.05em;display:flex;gap:8px;align-items:center}
.gf-counter .i{color:var(--gf-accent2)}
.gf-obj{max-width:calc(340px*var(--gf-scale));padding:10px 14px}
.gf-obj h4{margin:0 0 6px;font-size:.72em;letter-spacing:.16em;text-transform:uppercase;color:var(--gf-accent)}
.gf-obj .q{font-weight:600;margin-bottom:4px}
.gf-obj div.o{font-size:.9em;color:var(--gf-dim);padding-left:16px;position:relative;margin:2px 0}
.gf-obj div.o:before{content:'';position:absolute;left:2px;top:.45em;width:7px;height:7px;border:1.5px solid var(--gf-accent);border-radius:2px}
.gf-obj div.o.done{text-decoration:line-through;opacity:.6}.gf-obj div.o.done:before{background:var(--gf-accent)}
.gf-prompt{position:absolute;left:50%;bottom:22%;transform:translateX(-50%);padding:8px 16px;font-weight:600;display:none;align-items:center;gap:10px}
.gf-key{display:inline-block;min-width:26px;padding:2px 7px;border-radius:5px;background:var(--gf-text);color:#111;font-weight:800;text-align:center;font-size:.85em}
.gf-toasts{position:absolute;top:18%;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px}
.gf-toast{padding:10px 22px;font-weight:600;animation:gfToast 3.2s forwards;text-align:center}
.gf-toast.big{font-size:1.6em;letter-spacing:.06em;padding:14px 34px;border-left:3px solid var(--gf-accent2)}
.gf-toast small{display:block;font-weight:400;color:var(--gf-dim);font-size:.6em;letter-spacing:.2em;text-transform:uppercase}
@keyframes gfToast{0%{opacity:0;transform:translateY(-10px)}8%{opacity:1;transform:none}85%{opacity:1}100%{opacity:0;transform:translateY(-6px)}}
.gf-dialog{position:absolute;left:50%;bottom:6%;transform:translateX(-50%);width:min(760px,92vw);padding:18px 22px;display:none;pointer-events:auto}
.gf-dialog .sp{font-weight:800;color:var(--gf-accent2);letter-spacing:.06em;margin-bottom:6px;text-transform:uppercase;font-size:.85em}
.gf-dialog .tx{font-size:1.12em;line-height:1.5;min-height:2.6em}
.gf-dialog .ch{margin-top:12px;display:flex;flex-direction:column;gap:6px}
.gf-dialog button,.gf-menu button{pointer-events:auto;font:inherit;color:var(--gf-text);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:9px 14px;text-align:left;cursor:pointer;transition:all .12s}
.gf-dialog button:hover,.gf-dialog button:focus,.gf-menu button:hover,.gf-menu button:focus{background:var(--gf-accent);color:#071018;outline:none;transform:translateX(3px)}
.gf-dialog .hint{position:absolute;right:16px;bottom:10px;font-size:.75em;color:var(--gf-dim)}
.gf-sub{position:absolute;left:50%;bottom:16%;transform:translateX(-50%);padding:6px 14px;background:rgba(0,0,0,.6);border-radius:6px;font-size:1.05em;display:none;max-width:80vw;text-align:center}
.gf-mini{width:calc(190px*var(--gf-scale));height:calc(190px*var(--gf-scale));border-radius:50%;overflow:hidden;padding:0;position:relative}
.gf-mini canvas{width:100%;height:100%;display:block}
.gf-compass{position:absolute;top:14px;left:50%;transform:translateX(-50%);width:420px;height:30px;overflow:hidden;mask-image:linear-gradient(90deg,transparent,#000 20%,#000 80%,transparent)}
.gf-compass .s{position:absolute;top:6px;white-space:nowrap;font-weight:700;font-size:.8em;color:var(--gf-dim)}
.gf-speed{padding:10px 18px;text-align:right;min-width:170px}
.gf-speed .v{font-size:2.6em;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
.gf-speed .u{color:var(--gf-dim);font-size:.75em;letter-spacing:.2em}
.gf-dmg{position:absolute;font-weight:900;font-size:1.3em;color:#fff;text-shadow:0 2px 6px #000,0 0 2px #000;animation:gfDmg .9s forwards;pointer-events:none}
.gf-dmg.crit{color:var(--gf-accent2);font-size:1.7em}
@keyframes gfDmg{0%{opacity:0;transform:translate(-50%,0) scale(.6)}15%{opacity:1;transform:translate(-50%,-14px) scale(1.15)}100%{opacity:0;transform:translate(-50%,-60px) scale(1)}}
.gf-boss{position:absolute;top:58px;left:50%;transform:translateX(-50%);width:min(560px,80vw);padding:8px 14px;display:none}
.gf-boss .n{text-align:center;font-weight:800;letter-spacing:.2em;text-transform:uppercase;font-size:.8em;margin-bottom:5px}
.gf-cross{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 0 0 2px rgba(0,0,0,.35);display:none}
.gf-letter{position:absolute;left:0;right:0;height:0;background:#000;transition:height .6s}
.gf-letter.t{top:0}.gf-letter.b{bottom:0}
.gf-fade{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .6s;pointer-events:none}
.gf-flash{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .35s;background:radial-gradient(ellipse at center,transparent 45%,rgba(255,40,60,.55))}
.gf-menu{position:absolute;inset:0;display:none;align-items:center;justify-content:center;pointer-events:auto;background:radial-gradient(ellipse at 30% 40%,rgba(10,14,22,.35),rgba(5,7,12,.88))}
.gf-menu .box{min-width:340px;max-width:min(560px,92vw);padding:28px 30px;display:flex;flex-direction:column;gap:9px}
.gf-menu h1{margin:0 0 4px;font-size:2.6em;letter-spacing:.04em;line-height:1.05;background:linear-gradient(90deg,var(--gf-text),var(--gf-accent));-webkit-background-clip:text;background-clip:text;color:transparent}
.gf-menu h2{margin:0 0 6px;font-size:1.4em}
.gf-menu p{margin:0 0 12px;color:var(--gf-dim);line-height:1.5}
.gf-menu .row{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:.92em}
.gf-menu input[type=range]{width:160px;accent-color:var(--gf-accent)}
.gf-menu select{font:inherit;background:#1a2230;color:var(--gf-text);border:1px solid #334;border-radius:6px;padding:3px 6px}
.gf-menu .keys{display:grid;grid-template-columns:1fr auto;gap:4px 18px;font-size:.88em;color:var(--gf-dim);margin:6px 0 10px}
.gf-menu .scroll{max-height:56vh;overflow:auto;display:flex;flex-direction:column;gap:9px;padding-right:4px}
.gf-loading{position:absolute;inset:0;background:#05070c;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;z-index:20;pointer-events:auto;transition:opacity .5s}
.gf-loading .bar{width:min(420px,70vw);height:4px;background:#1a2230;border-radius:2px;overflow:hidden}
.gf-loading .bar div{height:100%;width:0;background:var(--gf-accent);transition:width .2s}
.gf-loading .tip{color:var(--gf-dim);font-size:.9em}
.gf-hc .gf-panel{background:rgba(0,0,0,.92);border-color:#fff}
.gf-touch{position:fixed;inset:0;pointer-events:none;z-index:11}
.gf-stick{position:absolute;left:30px;bottom:30px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.2);pointer-events:auto}
.gf-knob{position:absolute;left:35px;top:35px;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.35)}
.gf-touch-btns{position:absolute;right:24px;bottom:30px;display:flex;gap:12px;pointer-events:auto}
.gf-touch-btns button{width:64px;height:64px;border-radius:50%;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;font-weight:800;font-size:18px}
@media (max-width:700px){.gf-mini{width:120px;height:120px}.gf-bar{width:180px}.gf-compass{width:240px}}
`;

const COLOR_FILTERS = {
  none: null,
  protanopia: '0.567,0.433,0,0,0 0.558,0.442,0,0,0 0,0.242,0.758,0,0 0,0,0,1,0',
  deuteranopia: '0.625,0.375,0,0,0 0.7,0.3,0,0,0 0,0.3,0.7,0,0 0,0,0,1,0',
  tritanopia: '0.95,0.05,0,0,0 0,0.433,0.567,0,0 0,0.475,0.525,0,0 0,0,0,1,0',
  highSaturation: '1.35,-0.2,-0.15,0,0 -0.15,1.3,-0.15,0,0 -0.15,-0.2,1.35,0,0 0,0,0,1,0',
};

export const DEFAULT_SETTINGS = { master: 0.8, music: 0.55, sfx: 0.9, quality: 'auto', sensitivity: 1, invertY: false, textScale: 1, subtitles: true, highContrast: false, colorFilter: 'none', reducedMotion: false, shake: 1 };

export class UI {
  constructor({ container = document.body, title = 'Game', theme = {}, gameId = 'game' } = {}) {
    if (!document.getElementById('gf-css')) { const s = document.createElement('style'); s.id = 'gf-css'; s.textContent = CSS; document.head.appendChild(s); }
    this.root = document.createElement('div'); this.root.className = 'gf-ui'; container.appendChild(this.root);
    for (const [k, v] of Object.entries(theme)) document.documentElement.style.setProperty('--gf-' + k, v);
    this.title = title; this.gameId = gameId;
    this.el = {};
    for (const c of ['tl', 'tr', 'bl', 'br']) { const d = document.createElement('div'); d.className = 'gf-' + c; this.root.appendChild(d); this.el[c] = d; }
    this.root.insertAdjacentHTML('beforeend', `<div class="gf-letter t"></div><div class="gf-letter b"></div><div class="gf-flash"></div><div class="gf-cross"></div>
      <div class="gf-toasts"></div><div class="gf-prompt gf-panel"></div><div class="gf-sub"></div>
      <div class="gf-boss gf-panel"><div class="n"></div><div class="gf-bar" style="width:100%;padding:0"><div class="t"><div class="g"></div><div class="f" style="background:var(--gf-danger)"></div></div></div></div>
      <div class="gf-dialog gf-panel"><div class="sp"></div><div class="tx"></div><div class="ch"></div><div class="hint"></div></div>
      <div class="gf-menu"></div><div class="gf-fade"></div>
      <svg width="0" height="0" style="position:absolute"><filter id="gf-cf"><feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/></filter></svg>`);
    const q = (s) => this.root.querySelector(s);
    Object.assign(this.el, { toasts: q('.gf-toasts'), prompt: q('.gf-prompt'), sub: q('.gf-sub'), boss: q('.gf-boss'), dialog: q('.gf-dialog'), menu: q('.gf-menu'), fade: q('.gf-fade'), flash: q('.gf-flash'), cross: q('.gf-cross'), lt: q('.gf-letter.t'), lb: q('.gf-letter.b') });
    this.widgets = {};
    this.settings = this.loadSettings();
    this.onSettings = null;
    this.menuOpen = null;
    this.dialogueOpen = false;
    this.applySettings();
  }
  // ---------- settings ----------
  loadSettings() { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('gf-settings:' + this.gameId) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; } }
  saveSettings() { try { localStorage.setItem('gf-settings:' + this.gameId, JSON.stringify(this.settings)); } catch { /* storage blocked */ } this.applySettings(); this.onSettings?.(this.settings); }
  applySettings() {
    const s = this.settings;
    document.documentElement.style.setProperty('--gf-scale', s.textScale);
    this.root.classList.toggle('gf-hc', !!s.highContrast);
    const m = COLOR_FILTERS[s.colorFilter];
    const canvas = this.canvas;
    if (m) { this.root.querySelector('#gf-cf feColorMatrix').setAttribute('values', m.replace(/,/g, ' ')); if (canvas) canvas.style.filter = 'url(#gf-cf)'; } else if (canvas) canvas.style.filter = '';
  }
  // ---------- HUD widgets ----------
  bar(id, { label = id, color = 'var(--gf-ok)', corner = 'tl', value = 1, showValue = false } = {}) {
    const d = document.createElement('div'); d.className = 'gf-bar gf-panel';
    d.innerHTML = `<label><span>${label}</span><span class="v"></span></label><div class="t"><div class="g"></div><div class="f" style="background:${color}"></div></div>`;
    this.el[corner].appendChild(d);
    const f = d.querySelector('.f'), g = d.querySelector('.g'), v = d.querySelector('.v');
    const w = { el: d, set: (r, text) => { r = Math.max(0, Math.min(1, r)); f.style.transform = `scaleX(${r})`; g.style.transform = `scaleX(${r})`; if (showValue || text) v.textContent = text ?? Math.round(r * 100); }, show: (b) => (d.style.display = b ? '' : 'none') };
    w.set(value); this.widgets[id] = w; return w;
  }
  counter(id, { icon = '◆', label = '', corner = 'tr', value = '0' } = {}) {
    const d = document.createElement('div'); d.className = 'gf-counter gf-panel';
    d.innerHTML = `<span class="i">${icon}</span><span class="l" style="color:var(--gf-dim);font-weight:400">${label}</span><span class="v">${value}</span>`;
    this.el[corner].appendChild(d);
    const v = d.querySelector('.v'); const w = { el: d, set: (t) => { if (v.textContent !== String(t)) { v.textContent = t; d.animate?.([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], 200); } }, show: (b) => (d.style.display = b ? '' : 'none') };
    this.widgets[id] = w; return w;
  }
  // Rating / wanted-level stars: set(n, { flash }) fills n of max icons; hidden at 0 unless showEmpty.
  stars(id, { max = 5, corner = 'tr', icon = '★', label = '', color = 'var(--gf-warn, #ffcf3a)', showEmpty = false } = {}) {
    const d = document.createElement('div'); d.className = 'gf-counter gf-panel gf-stars'; d.style.display = showEmpty ? '' : 'none';
    d.innerHTML = (label ? `<span class="l" style="color:var(--gf-dim);font-weight:400">${label}</span>` : '') + Array.from({ length: max }, () => `<span class="s" style="opacity:.22;transition:opacity .2s,color .2s">${icon}</span>`).join('');
    this.el[corner].appendChild(d);
    const icons = [...d.querySelectorAll('.s')]; let anim = null, last = -1, lastFlash = false;
    const w = { el: d, value: 0, flashing: false, set: (n, { flash = false } = {}) => {
      if (n === last && flash === lastFlash) return;
      icons.forEach((s, i) => { s.style.opacity = i < n ? '1' : '.22'; s.style.color = i < n ? color : ''; });
      d.style.display = n > 0 || showEmpty ? '' : 'none';
      if (n > last && last >= 0) d.animate?.([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], 260);
      if (flash && !anim) anim = d.animate?.([{ opacity: 1 }, { opacity: 0.3 }], { duration: 420, iterations: Infinity, direction: 'alternate' }) || null;
      if (!flash && anim) { anim.cancel(); anim = null; }
      last = n; lastFlash = flash; w.value = n; w.flashing = flash;
    }, show: (b) => (d.style.display = b ? '' : 'none') };
    this.widgets[id] = w; return w;
  }
  objectives(corner = 'tr') {
    const d = document.createElement('div'); d.className = 'gf-obj gf-panel'; d.style.display = 'none'; this.el[corner].appendChild(d);
    const w = { el: d, set: (title, items = [], header = 'Objective') => {
      if (!title) { d.style.display = 'none'; return; }
      d.style.display = '';
      d.innerHTML = `<h4>${header}</h4><div class="q">${title}</div>` + items.map((o) => `<div class="o ${o.done ? 'done' : ''}">${o.text}${o.optional ? ' <i>(optional)</i>' : ''}</div>`).join('');
    } };
    this.widgets.objectives = w; return w;
  }
  prompt(text, key = 'E') {
    const p = this.el.prompt;
    if (!text) { p.style.display = 'none'; this._prompt = null; return; }
    if (this._prompt === text + key) return;
    this._prompt = text + key; p.innerHTML = `<span class="gf-key">${key}</span><span>${text}</span>`; p.style.display = 'flex';
  }
  toast(text, { big = false, sub = '', ms = 3200 } = {}) {
    const d = document.createElement('div'); d.className = 'gf-toast gf-panel' + (big ? ' big' : '');
    d.innerHTML = (sub ? `<small>${sub}</small>` : '') + text; d.style.animationDuration = ms + 'ms';
    this.el.toasts.appendChild(d); setTimeout(() => d.remove(), ms);
    this.lastToast = text;
  }
  subtitle(text, ms = 3000, speaker = '') {
    if (!this.settings.subtitles) return;
    const s = this.el.sub; s.innerHTML = speaker ? `<b style="color:var(--gf-accent2)">${speaker}:</b> ${text}` : text; s.style.display = 'block';
    clearTimeout(this._subT); this._subT = setTimeout(() => (s.style.display = 'none'), ms);
  }
  damageNumber(x, y, value, crit = false) {
    const d = document.createElement('div'); d.className = 'gf-dmg' + (crit ? ' crit' : ''); d.textContent = Math.round(value);
    d.style.left = x + 'px'; d.style.top = y + 'px'; this.root.appendChild(d); setTimeout(() => d.remove(), 900);
  }
  boss(name, ratio) {
    const b = this.el.boss; if (name === null) { b.style.display = 'none'; return; }
    b.style.display = 'block'; b.querySelector('.n').textContent = name;
    const r = Math.max(0, ratio); b.querySelector('.f').style.transform = `scaleX(${r})`; b.querySelector('.g').style.transform = `scaleX(${r})`;
  }
  crosshair(on) { this.el.cross.style.display = on ? 'block' : 'none'; }
  letterbox(on) { const h = on ? '11vh' : '0'; this.el.lt.style.height = h; this.el.lb.style.height = h; }
  flash(intensity = 1) { if (this.settings.reducedMotion) intensity *= 0.4; const f = this.el.flash; f.style.transition = 'none'; f.style.opacity = intensity; requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = 0; }); }
  fade(to = 1, ms = 600) { const f = this.el.fade; f.style.transition = `opacity ${ms}ms`; f.style.opacity = to; return new Promise((r) => setTimeout(r, ms)); }
  minimap({ corner = 'br', size = 190, range = 80 } = {}) {
    const d = document.createElement('div'); d.className = 'gf-mini gf-panel'; const c = document.createElement('canvas'); c.width = c.height = size * 2; d.appendChild(c); this.el[corner].appendChild(d);
    const ctx = c.getContext('2d');
    const w = { el: d, canvas: c, ctx, range,
      // draw({ center:{x,z}, yaw, background?(ctx, toMap), markers:[{x,z,color,size,shape}] })
      draw: ({ center, yaw = 0, background, markers = [] }) => {
        const S = c.width, k = S / 2 / w.range;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, S, S);
        ctx.fillStyle = 'rgba(14,20,30,.9)'; ctx.fillRect(0, 0, S, S);
        ctx.translate(S / 2, S / 2); ctx.rotate(yaw);
        const toMap = (x, z) => [(x - center.x) * k, (z - center.z) * k]; // yaw = camera yaw (forward = -sin,-cos) -> up
        background?.(ctx, toMap, k);
        for (const m of markers) {
          let [mx, my] = toMap(m.x, m.z); const dd = Math.hypot(mx, my), lim = S / 2 - 10;
          if (dd > lim) { if (!m.clamp) continue; mx *= lim / dd; my *= lim / dd; }
          ctx.fillStyle = m.color || '#fff'; ctx.beginPath();
          if (m.shape === 'diamond') { const s = m.size || 7; ctx.moveTo(mx, my - s); ctx.lineTo(mx + s, my); ctx.lineTo(mx, my + s); ctx.lineTo(mx - s, my); }
          else ctx.arc(mx, my, m.size || 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(S / 2, S / 2 - 12); ctx.lineTo(S / 2 + 8, S / 2 + 8); ctx.lineTo(S / 2, S / 2 + 3); ctx.lineTo(S / 2 - 8, S / 2 + 8); ctx.fill();
      } };
    this.widgets.minimap = w; return w;
  }
  compass() {
    const d = document.createElement('div'); d.className = 'gf-compass'; this.root.appendChild(d);
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const spans = []; for (let k = -1; k <= 1; k++) labels.forEach((l, i) => { const s = document.createElement('span'); s.className = 's'; s.textContent = l; s.dataset.a = (i * 45 + k * 360); d.appendChild(s); spans.push(s); });
    const w = { el: d, set: (yawDeg, markers = []) => {
      for (const s of spans) { const off = (+s.dataset.a - yawDeg); s.style.left = (210 + off * 2.2 - 8) + 'px'; s.style.color = s.textContent === 'N' ? 'var(--gf-accent2)' : ''; }
      d.querySelectorAll('.m').forEach((m) => m.remove());
      for (const m of markers) { let off = m.angle - yawDeg; while (off > 180) off -= 360; while (off < -180) off += 360; const e = document.createElement('span'); e.className = 's m'; e.textContent = '▼'; e.style.color = m.color || 'var(--gf-accent)'; e.style.left = (210 + off * 2.2 - 6) + 'px'; d.appendChild(e); }
    } };
    this.widgets.compass = w; return w;
  }
  speedometer(corner = 'br') {
    const d = document.createElement('div'); d.className = 'gf-speed gf-panel';
    d.innerHTML = `<div class="v">0</div><div class="u">KM/H · <span class="gear">1</span></div><div class="gf-bar" style="width:100%;padding:6px 0 0"><div class="t"><div class="f" style="background:var(--gf-accent2)"></div></div></div>`;
    this.el[corner].appendChild(d);
    const v = d.querySelector('.v'), g = d.querySelector('.gear'), f = d.querySelector('.f');
    const w = { el: d, set: (kmh, gear, boost = 1) => { v.textContent = Math.round(kmh); g.textContent = gear; f.style.transform = `scaleX(${boost})`; } };
    this.widgets.speed = w; return w;
  }
  // ---------- dialogue ----------
  showDialogue({ speaker = '', text = '', choices = [] }, onChoice, { typeSpeed = 45 } = {}) {
    const d = this.el.dialog; this.dialogueOpen = true; d.style.display = 'block';
    d.querySelector('.sp').textContent = speaker;
    const tx = d.querySelector('.tx'), ch = d.querySelector('.ch'), hint = d.querySelector('.hint');
    ch.innerHTML = '';
    clearInterval(this._typeT);
    tx.textContent = '';
    const full = () => { tx.textContent = text; this._typing = false; renderChoices(); };
    const renderChoices = () => {
      ch.innerHTML = ''; hint.textContent = choices.length ? 'Choose 1-' + choices.length : '[E / Space] Continue';
      choices.forEach((c, k) => { const b = document.createElement('button'); b.textContent = `${k + 1}. ${c.text}`; b.onclick = (e) => { e.stopPropagation(); onChoice?.(c.index ?? k); }; ch.appendChild(b); });
    };
    this._typing = true; this._skipType = full;
    // typewriter advances in simulation time via update(dt) so it is deterministic under test stepping
    this._type = { text, shown: 0, speed: typeSpeed, el: tx, done: full };
    if (this.settings.reducedMotion || typeSpeed <= 0) full();
    d.onclick = () => { if (this._typing) full(); else if (!choices.length) onChoice?.(null); };
  }
  update(dt) {
    const t = this._type; if (!t || !this._typing) return;
    t.shown += dt * t.speed * 1.6; const n = Math.floor(t.shown);
    if (n >= t.text.length) { this._type = null; t.done(); } else t.el.textContent = t.text.slice(0, n);
  }
  // returns true if a typewriter effect was skipped
  skipTyping() { if (this._typing) { this._skipType(); return true; } return false; }
  hideDialogue() { this.el.dialog.style.display = 'none'; this.dialogueOpen = false; clearInterval(this._typeT); }
  // ---------- menus ----------
  _menu(html, buttons = []) {
    const m = this.el.menu; m.innerHTML = `<div class="box gf-panel">${html}</div>`; m.style.display = 'flex';
    const box = m.querySelector('.box');
    for (const [label, fn, opts = {}] of buttons) { const b = document.createElement('button'); b.textContent = label; if (opts.id) b.id = opts.id; b.onclick = () => { this.sound?.('uiClick'); fn(); }; b.onmouseenter = () => this.sound?.('uiHover'); box.appendChild(b); }
    setTimeout(() => box.querySelector('button')?.focus(), 50);
    return box;
  }
  closeMenu() { this.el.menu.style.display = 'none'; this.el.menu.innerHTML = ''; this.menuOpen = null; }
  mainMenu({ subtitle = '', onStart, onContinue = null, controls = [], credits = '' }) {
    this.menuOpen = 'main';
    const btns = [];
    if (onContinue) btns.push(['Continue', () => { this.closeMenu(); onContinue(); }, { id: 'gf-continue' }]);
    btns.push(['New Game', () => { this.closeMenu(); onStart(); }, { id: 'gf-start' }]);
    btns.push(['Settings', () => this.settingsMenu(() => this.mainMenu({ subtitle, onStart, onContinue, controls, credits }))]);
    btns.push(['Controls', () => this.controlsMenu(controls, () => this.mainMenu({ subtitle, onStart, onContinue, controls, credits }))]);
    if (credits) btns.push(['Credits', () => { this._menu(`<h2>Credits</h2><p>${credits}</p>`, [['Back', () => this.mainMenu({ subtitle, onStart, onContinue, controls, credits })]]); }]);
    this._menu(`<h1>${this.title}</h1><p>${subtitle}</p>`, btns);
  }
  pauseMenu({ onResume, onRestart, onQuit, onSave, controls = [] }) {
    this.menuOpen = 'pause';
    const btns = [['Resume', () => { this.closeMenu(); onResume(); }, { id: 'gf-resume' }]];
    if (onSave) btns.push(['Save Game', () => { onSave(); this.toast('Game saved'); }]);
    btns.push(['Settings', () => this.settingsMenu(() => this.pauseMenu({ onResume, onRestart, onQuit, onSave, controls }))]);
    btns.push(['Controls', () => this.controlsMenu(controls, () => this.pauseMenu({ onResume, onRestart, onQuit, onSave, controls }))]);
    if (onRestart) btns.push(['Restart', () => { this.closeMenu(); onRestart(); }]);
    if (onQuit) btns.push(['Quit to Title', () => { this.closeMenu(); onQuit(); }]);
    this._menu('<h2>Paused</h2>', btns);
  }
  controlsMenu(controls, back) {
    this._menu(`<h2>Controls</h2><div class="keys">${controls.map(([a, k]) => `<span>${a}</span><span class="gf-key">${k}</span>`).join('')}</div>`, [['Back', back]]);
  }
  settingsMenu(back) {
    const s = this.settings;
    const slider = (k, label, min = 0, max = 1, step = 0.05) => `<div class="row"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}"></div>`;
    const check = (k, label) => `<div class="row"><span>${label}</span><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}></div>`;
    const select = (k, label, opts) => `<div class="row"><span>${label}</span><select data-k="${k}">${opts.map((o) => `<option ${s[k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    const box = this._menu(`<h2>Settings</h2><div class="scroll">
      ${slider('master', 'Master volume')}${slider('music', 'Music')}${slider('sfx', 'Effects')}
      ${select('quality', 'Graphics quality (reload)', ['auto', 'low', 'medium', 'high'])}
      ${slider('sensitivity', 'Camera sensitivity', 0.2, 3, 0.1)}${check('invertY', 'Invert camera Y')}
      ${slider('textScale', 'Text size', 0.8, 1.6, 0.1)}${check('subtitles', 'Subtitles')}${check('highContrast', 'High-contrast UI')}
      ${select('colorFilter', 'Colour filter', Object.keys(COLOR_FILTERS))}${check('reducedMotion', 'Reduced motion')}${slider('shake', 'Camera shake', 0, 1, 0.1)}
    </div>`, [['Back', () => { this.saveSettings(); back(); }]]);
    box.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('input', () => {
      const k = inp.dataset.k; s[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? +inp.value : inp.value;
      this.saveSettings();
    }));
  }
  endScreen({ title = 'Game Over', text = '', stats = {}, onRetry, onQuit, victory = false }) {
    this.menuOpen = 'end';
    const rows = Object.entries(stats).map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');
    const btns = []; if (onRetry) btns.push([victory ? 'Play Again' : 'Retry', () => { this.closeMenu(); onRetry(); }, { id: 'gf-retry' }]); if (onQuit) btns.push(['Title Screen', () => { this.closeMenu(); onQuit(); }]);
    this._menu(`<h1 style="${victory ? '' : 'background:linear-gradient(90deg,#fff,var(--gf-danger));-webkit-background-clip:text;background-clip:text'}">${title}</h1><p>${text}</p>${rows}`, btns);
  }
  loading(tip = '') {
    const d = document.createElement('div'); d.className = 'gf-loading'; d.innerHTML = `<h2 style="margin:0;letter-spacing:.1em">${this.title}</h2><div class="bar"><div></div></div><div class="tip">${tip}</div>`;
    this.root.appendChild(d);
    const bar = d.querySelector('.bar div'), t = d.querySelector('.tip');
    return { set: (r, msg) => { bar.style.width = Math.round(r * 100) + '%'; if (msg) t.textContent = msg; }, done: () => { d.style.opacity = 0; setTimeout(() => d.remove(), 500); } };
  }
  // project a world position to screen pixels
  static project(v, camera) {
    const p = v.clone().project(camera);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight, visible: p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 };
  }
}
