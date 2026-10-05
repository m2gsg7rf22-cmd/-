import { HOTBAR_SIZE, type Inventory, type ItemStack } from '../game/inventory';
import { itemDef, itemName } from '../game/items';
import { iconFor } from './icons';

const SVG_HEART = (fill: string, half = false) =>
  `<svg viewBox="0 0 9 8" shape-rendering="crispEdges"><path fill="#1a0b0b" d="M1 0h2v1h1v1h1V1h1V0h2v1h1v3H8v1H7v1H6v1H5v1H4V7H3V6H2V5H1V4H0V1h1z"/>` +
  `<path fill="${fill}" d="M1 1h2v1h1v1h1V2h1V1h2v3H7v1H6v1H5v1H4V6H3V5H2V4H1z"${half ? ' clip-path="inset(0 50% 0 0)"' : ''}/>` +
  `<path fill="rgba(255,255,255,.5)" d="M2 2h1v1H2z"/></svg>`;

const SVG_FOOD = (fill: string) =>
  `<svg viewBox="0 0 9 9" shape-rendering="crispEdges"><path fill="#1c1208" d="M2 0h5v1h1v1h1v5H8v1H7v1H2V8H1V7H0V2h1V1h1z"/>` +
  `<path fill="${fill}" d="M2 1h5v1h1v5H7v1H2V7H1V2h1z"/><path fill="rgba(255,255,255,.45)" d="M2 2h2v1H3v1H2z"/></svg>`;

const SVG_BUBBLE = `<svg viewBox="0 0 8 8" shape-rendering="crispEdges"><path fill="#cfe8ff" d="M2 0h4v1h1v1h1v4H7v1H6v1H2V7H1V6H0V2h1V1h1z"/><path fill="#5aa0e6" d="M2 1h4v1h1v4H6v1H2V6H1V2h1z"/><path fill="#fff" d="M2 2h1v1H2z"/></svg>`;

function svgUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}`;
}

const HEART_FULL = svgUrl(SVG_HEART('#e8423a'));
const HEART_HALF = svgUrl(SVG_HEART('#e8423a', true));
const HEART_EMPTY = svgUrl(SVG_HEART('#3a1c1c'));
const FOOD_FULL = svgUrl(SVG_FOOD('#e8a03a'));
const FOOD_HALF = svgUrl(SVG_FOOD('#9a6a2a'));
const FOOD_EMPTY = svgUrl(SVG_FOOD('#3a2a1a'));
const BUBBLE = svgUrl(SVG_BUBBLE);

export function slotHTML(s: ItemStack | null): string {
  if (!s) return '';
  let html = `<img src="${iconFor(s.id)}" alt="" draggable="false">`;
  if (s.count > 1) html += `<span class="count">${s.count}</span>`;
  const tool = itemDef(s.id)?.tool;
  if (tool && s.dur !== undefined && s.dur < tool.durability) {
    const f = Math.max(0, s.dur / tool.durability);
    const hue = Math.round(f * 120);
    html += `<span class="dur"><i style="width:${(f * 100).toFixed(0)}%;background:hsl(${hue} 80% 50%)"></i></span>`;
  }
  return html;
}

const ICONS = {
  jump: '<svg viewBox="0 0 24 24"><path d="M12 4l7 8h-4v8H9v-8H5z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 20l-7-8h4V4h6v8h4z"/></svg>',
  mine: '<svg viewBox="0 0 24 24"><path d="M3 7c4-4 10-5 15-2l-2 2 5 5-2 2-5-5-9 9-2-2 9-9-2-2c-2-1-5-1-7 2z"/></svg>',
  place: '<svg viewBox="0 0 24 24"><path d="M12 2l9 5v10l-9 5-9-5V7zm0 2.3L5.5 8 12 11.6 18.5 8zM5 9.7v6.1l6 3.4v-6.1zm14 0l-6 3.4v6.1l6-3.4z"/></svg>',
  inv: '<svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>',
  fly: '<svg viewBox="0 0 24 24"><path d="M2 14c4-1 7-4 10-10 3 6 6 9 10 10-4 0-7 2-10 6-3-4-6-6-10-6z"/></svg>',
};

export class Hud {
  private root: HTMLElement;
  private hotbar: HTMLElement;
  private slots: HTMLElement[] = [];
  private hearts: HTMLElement;
  private food: HTMLElement;
  private air: HTMLElement;
  private bars: HTMLElement;
  private itemNameEl: HTMLElement;
  private toasts: HTMLElement;
  private debugEl: HTMLElement;
  private modeEl: HTMLElement;
  private clockEl: HTMLElement;
  private lastHotbar = '';
  private lastStats = '';
  private lastSelKey = '';
  private nameTimer = 0;
  readonly touchRoot: HTMLElement;
  onHotbarSelect?: (i: number) => void;

  constructor(root: HTMLElement, touchRoot: HTMLElement) {
    this.root = root;
    this.touchRoot = touchRoot;
    root.innerHTML = `
      <div class="crosshair"></div>
      <div class="mode-badge"></div>
      <div class="clock"></div>
      <div class="toasts"></div>
      <div class="debug" hidden></div>
      <div class="hud-bottom">
        <div class="item-name"></div>
        <div class="air-row"></div>
        <div class="bars"><div class="group hearts"></div><div class="group right food"></div></div>
        <div class="hotbar" role="toolbar" aria-label="Hotbar"></div>
      </div>`;
    this.hotbar = root.querySelector('.hotbar')!;
    this.hearts = root.querySelector('.hearts')!;
    this.food = root.querySelector('.food')!;
    this.air = root.querySelector('.air-row')!;
    this.bars = root.querySelector('.bars')!;
    this.itemNameEl = root.querySelector('.item-name')!;
    this.toasts = root.querySelector('.toasts')!;
    this.debugEl = root.querySelector('.debug')!;
    this.modeEl = root.querySelector('.mode-badge')!;
    this.clockEl = root.querySelector('.clock')!;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.dataset.i = String(i);
      this.hotbar.appendChild(s);
      this.slots.push(s);
    }
    this.hotbar.addEventListener('pointerdown', (e) => {
      const t = (e.target as HTMLElement).closest('.slot') as HTMLElement | null;
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      this.onHotbarSelect?.(Number(t.dataset.i));
    });

    touchRoot.innerHTML = `
      <div class="touch-zone"></div>
      <div class="joy-hint">MOVE</div>
      <div class="joy-base"><div class="joy-knob"></div></div>
      <div class="t-top">
        <div class="tbtn sm" data-touch="fly" title="Toggle flight" hidden>${ICONS.fly}</div>
        <div class="tbtn sm" data-touch="inventory" title="Inventory">${ICONS.inv}</div>
        <div class="tbtn sm" data-touch="pause" title="Pause">${ICONS.pause}</div>
      </div>
      <div class="t-actions">
        <div class="tbtn" data-touch="place" title="Place / Use">${ICONS.place}</div>
        <div class="tbtn" data-touch="mine" title="Mine / Attack">${ICONS.mine}</div>
        <div class="tbtn" data-touch="descend" title="Descend" hidden>${ICONS.down}</div>
        <div class="tbtn" data-touch="jump" title="Jump">${ICONS.jump}</div>
      </div>`;
  }

  setMode(creative: boolean): void {
    this.modeEl.textContent = creative ? 'CREATIVE' : '';
    this.bars.style.visibility = creative ? 'hidden' : 'visible';
    (this.touchRoot.querySelector('[data-touch="fly"]') as HTMLElement).hidden = !creative;
  }

  setFlying(flying: boolean): void {
    (this.touchRoot.querySelector('[data-touch="descend"]') as HTMLElement).hidden = !flying;
  }

  updateHotbar(inv: Inventory, selected: number): void {
    const key = JSON.stringify(inv.slots.slice(0, HOTBAR_SIZE)) + selected;
    if (key === this.lastHotbar) return;
    this.lastHotbar = key;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      this.slots[i].innerHTML = slotHTML(inv.slots[i]);
      this.slots[i].classList.toggle('sel', i === selected);
    }
    const s = inv.slots[selected];
    const selKey = `${selected}:${s?.id ?? -1}`;
    if (selKey !== this.lastSelKey) {
      this.lastSelKey = selKey;
      this.showItemName(s ? itemName(s.id) : '');
    }
  }

  showItemName(name: string): void {
    this.itemNameEl.textContent = name;
    this.itemNameEl.classList.toggle('show', !!name);
    clearTimeout(this.nameTimer);
    if (name) this.nameTimer = window.setTimeout(() => this.itemNameEl.classList.remove('show'), 1800);
  }

  updateStats(health: number, hunger: number, air: number, maxAir: number, underwater: boolean): void {
    const key = `${Math.ceil(health)}|${Math.ceil(hunger)}|${underwater ? Math.ceil(air) : -1}`;
    if (key === this.lastStats) return;
    this.lastStats = key;
    const pips = (val: number, full: string, half: string, empty: string) => {
      let h = '';
      for (let i = 0; i < 10; i++) {
        const v = val - i * 2;
        h += `<img class="icon-pip" alt="" src="${v >= 2 ? full : v >= 1 ? half : empty}">`;
      }
      return h;
    };
    this.hearts.innerHTML = pips(Math.ceil(health), HEART_FULL, HEART_HALF, HEART_EMPTY);
    this.food.innerHTML = pips(Math.ceil(hunger), FOOD_FULL, FOOD_HALF, FOOD_EMPTY);
    this.hearts.setAttribute('aria-label', `Health ${Math.ceil(health)} of 20`);
    let a = '';
    if (underwater && air < maxAir) {
      const n = Math.ceil((air / maxAir) * 10);
      for (let i = 0; i < n; i++) a += `<img class="icon-pip" alt="" src="${BUBBLE}">`;
    }
    this.air.innerHTML = a;
  }

  setClock(timeOfDay: number, day: number): void {
    // 0 = 06:00
    const mins = Math.floor(((timeOfDay * 24 + 6) % 24) * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(Math.floor((mins % 60) / 10) * 10).padStart(2, '0');
    const txt = `Day ${day + 1} · ${hh}:${mm}`;
    if (this.clockEl.textContent !== txt) this.clockEl.textContent = txt;
  }

  toast(msg: string, warn = false, ms = 2600): void {
    const t = document.createElement('div');
    t.className = 'toast' + (warn ? ' warn' : '');
    t.textContent = msg;
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 450);
    }, ms);
  }

  setDebug(text: string | null): void {
    this.debugEl.hidden = text === null;
    if (text !== null) this.debugEl.textContent = text;
  }

  show(visible: boolean): void {
    this.root.hidden = !visible;
  }

  showTouch(visible: boolean): void {
    this.touchRoot.hidden = !visible;
  }

  reset(): void {
    this.lastHotbar = '';
    this.lastStats = '';
    this.toasts.innerHTML = '';
  }
}
