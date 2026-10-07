import { audio } from '../audio/audio';
import { canCraft, craft, hasIngredients, RECIPES, STATION_LABEL, type Station } from '../game/crafting';
import { HOTBAR_SIZE, type Inventory } from '../game/inventory';
import { allItemIds, isTool, itemHint, itemName, maxStack, TRAVEL_ITEMS } from '../game/items';
import { iconFor } from './icons';
import { slotHTML } from './hud';

export interface InventoryHost {
  inventory: Inventory;
  creative: boolean;
  selected: number;
  nearbyStations(): Set<Station>;
}

type Tab = 'craft' | 'library';

/** Inventory + crafting overlay. Works with mouse (click/drag/shift/right-click) and touch (tap-select). */
export class InventoryScreen {
  private el: HTMLElement;
  private picked = -1;
  private tab: Tab = 'craft';
  private dragFrom = -1;
  private stations = new Set<Station>();
  private cleanup: (() => void)[] = [];
  /** Name (and use) of the item under the pointer / controller focus. */
  private nameLine = '';

  constructor(parent: HTMLElement, private host: InventoryHost, private onClose: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'screen inv-screen';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Inventory');
    parent.appendChild(this.el);
    this.stations = host.nearbyStations();
    this.render();
    this.bind();
  }

  private render(): void {
    const inv = this.host.inventory;
    const slot = (i: number) => {
      const s = inv.slots[i];
      const cls = ['slot', i === this.picked ? 'picked' : ''].join(' ');
      return `<div class="${cls}" data-slot="${i}" data-name="${s ? s.id : ''}" title="${s ? itemName(s.id) : ''}">${slotHTML(s)}</div>`;
    };
    let grid = '';
    for (let i = HOTBAR_SIZE; i < inv.slots.length; i++) grid += slot(i);
    grid += '<div class="gap"></div>';
    for (let i = 0; i < HOTBAR_SIZE; i++) grid += slot(i);

    const tabs = this.host.creative
      ? `<div class="tabs"><button class="btn seg ${this.tab === 'craft' ? 'on' : ''}" data-tab="craft">Crafting</button><button class="btn seg ${this.tab === 'library' ? 'on' : ''}" data-tab="library">Block Library</button></div>`
      : '';

    let right = '';
    if (this.tab === 'library' && this.host.creative) {
      const lib = (id: number) => `<div class="slot" data-lib="${id}" data-name="${id}" title="${itemName(id)}"><img src="${iconFor(id)}" alt=""></div>`;
      const rest = allItemIds().filter((id) => !TRAVEL_ITEMS.includes(id));
      const blocks = rest.filter((id) => id < 256);
      const items = rest.filter((id) => id >= 256 && !isTool(id));
      const tools = rest.filter((id) => isTool(id));
      right = `<div class="library">
        <div class="lib-head">Travel between worlds</div>${TRAVEL_ITEMS.map(lib).join('')}
        <div class="lib-head">Blocks</div>${blocks.map(lib).join('')}
        <div class="lib-head">Items</div>${items.map(lib).join('')}
        <div class="lib-head">Tools</div>${tools.map(lib).join('')}
      </div>`;
    } else {
      const st = this.stations;
      const stationsHtml = (['bench', 'kiln'] as Station[])
        .map((s) => `<span class="station ${st.has(s) ? 'on' : ''}">${STATION_LABEL[s]} ${st.has(s) ? 'nearby' : 'not nearby'}</span>`)
        .join('');
      const sorted = [...RECIPES].sort((a, b) => Number(canCraft(inv, b, st)) - Number(canCraft(inv, a, st)));
      right = `<div class="stations">${stationsHtml}</div><div class="recipes">${sorted
        .map((r) => {
          const ok = canCraft(inv, r, st);
          const stationOk = r.station === 'hand' || st.has(r.station);
          const ings = r.ingredients
            .map(([id, n]) => `<span class="ing ${inv.count(id) >= n ? '' : 'missing'}"><img src="${iconFor(id)}" alt="">${n} ${itemName(id)}</span>`)
            .join('');
          const need = !stationOk ? `<span class="ing missing">Needs ${STATION_LABEL[r.station]}</span>` : '';
          return `<div class="recipe ${ok ? '' : 'locked'}"><img src="${iconFor(r.out.id)}" alt="">
            <div><div class="rname">${itemName(r.out.id)}${r.out.count > 1 ? ` ×${r.out.count}` : ''}</div><div class="ings">${ings}${need}</div></div>
            <button class="btn small ${ok ? 'primary' : ''}" data-craft="${r.id}" ${ok ? '' : 'disabled'}>Craft</button></div>`;
        })
        .join('')}</div>`;
    }

    const pickedStack = this.picked >= 0 ? inv.slots[this.picked] : null;
    this.el.innerHTML = `
      <div class="panel wide">
        <div class="inv-head"><h2>Inventory</h2><div class="inv-name" aria-live="polite">${this.nameLine}</div><button class="btn small" data-act="close">Close</button></div>
        <div class="inv-layout">
          <div>
            <div class="inv-grid">${grid}</div>
            <div class="inv-actions">
              <button class="btn small" data-act="split" ${pickedStack && pickedStack.count > 1 ? '' : 'disabled'}>Split</button>
              <button class="btn small danger" data-act="discard" ${pickedStack ? '' : 'disabled'}>Discard</button>
              <span class="inv-hint">${pickedStack ? `Selected: ${itemName(pickedStack.id)} — tap a slot to move` : 'Tap a slot to select, tap another to move. Drag works too.'}</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;min-height:0">${tabs}${right}</div>
        </div>
      </div>`;
  }

  private bind(): void {
    const on = (type: string, fn: (e: Event) => void) => {
      this.el.addEventListener(type, fn);
      this.cleanup.push(() => this.el.removeEventListener(type, fn));
    };
    on('contextmenu', (e) => e.preventDefault());
    // Show the name (and use) of whatever the pointer or the controller focus is on.
    const showName = (e: Event) => {
      const n = (e.target as HTMLElement).closest('[data-name]') as HTMLElement | null;
      const id = n && n.dataset.name ? Number(n.dataset.name) : NaN;
      this.nameLine = Number.isFinite(id) ? `<b>${itemName(id)}</b>${itemHint(id) ? ` <span>${itemHint(id)}</span>` : ''}` : '';
      const bar = this.el.querySelector('.inv-name');
      if (bar) bar.innerHTML = this.nameLine;
    };
    on('pointerover', showName);
    on('padfocus', showName);
    on('click', (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest('[data-act]') as HTMLElement | null;
      if (act) {
        const a = act.dataset.act;
        if (a === 'close') this.onClose();
        else if (a === 'split') this.split();
        else if (a === 'discard') this.discard();
        return;
      }
      const tab = t.closest('[data-tab]') as HTMLElement | null;
      if (tab) {
        this.tab = tab.dataset.tab as Tab;
        audio.click();
        this.render();
        return;
      }
      const c = t.closest('[data-craft]') as HTMLButtonElement | null;
      if (c && !c.disabled) {
        const r = RECIPES.find((x) => x.id === c.dataset.craft);
        if (r && craft(this.host.inventory, r, this.stations)) audio.craft();
        else if (r && hasIngredients(this.host.inventory, r)) audio.toolBreak();
        this.render();
        return;
      }
      const lib = t.closest('[data-lib]') as HTMLElement | null;
      if (lib) {
        const id = Number(lib.dataset.lib);
        this.host.inventory.add(id, maxStack(id));
        audio.pickup();
        this.render();
      }
    });
    on('pointerdown', (e) => {
      const pe = e as PointerEvent;
      const s = (pe.target as HTMLElement).closest('[data-slot]') as HTMLElement | null;
      if (!s) return;
      pe.preventDefault();
      const i = Number(s.dataset.slot);
      if (pe.button === 2) {
        this.splitFrom(i);
        return;
      }
      if (pe.shiftKey) {
        this.quickMove(i);
        return;
      }
      this.dragFrom = i;
    });
    on('pointerup', (e) => {
      const pe = e as PointerEvent;
      if (this.dragFrom < 0) return;
      const from = this.dragFrom;
      this.dragFrom = -1;
      const under = document.elementFromPoint(pe.clientX, pe.clientY)?.closest('[data-slot]') as HTMLElement | null;
      if (!under) return;
      const to = Number(under.dataset.slot);
      const inv = this.host.inventory;
      if (to !== from) {
        // Drag-and-drop.
        if (inv.slots[from]) {
          inv.move(from, to);
          audio.click();
        }
        this.picked = -1;
      } else if (this.picked >= 0 && this.picked !== to) {
        inv.move(this.picked, to);
        audio.click();
        this.picked = -1;
      } else if (this.picked === to) {
        this.picked = -1;
      } else if (inv.slots[to]) {
        this.picked = to;
        audio.click();
      }
      this.render();
    });
    on('pointercancel', () => (this.dragFrom = -1));
  }

  private splitFrom(i: number): void {
    const inv = this.host.inventory;
    const empty = inv.firstEmpty();
    if (empty >= 0 && inv.split(i, empty)) audio.click();
    this.render();
  }

  private split(): void {
    if (this.picked < 0) return;
    this.splitFrom(this.picked);
  }

  private discard(): void {
    if (this.picked < 0) return;
    this.host.inventory.slots[this.picked] = null;
    this.picked = -1;
    audio.toolBreak();
    this.render();
  }

  /** Shift-click: move between hotbar and backpack. */
  private quickMove(i: number): void {
    const inv = this.host.inventory;
    const s = inv.slots[i];
    if (!s) return;
    const toHotbar = i >= HOTBAR_SIZE;
    const range = toHotbar ? [0, HOTBAR_SIZE] : [HOTBAR_SIZE, inv.slots.length];
    for (let j = range[0]; j < range[1]; j++) {
      const t = inv.slots[j];
      if (t && t.id === s.id && t.dur === undefined && s.dur === undefined && t.count < maxStack(t.id)) inv.move(i, j);
      if (!inv.slots[i]) break;
    }
    if (inv.slots[i]) {
      for (let j = range[0]; j < range[1]; j++) {
        if (!inv.slots[j]) {
          inv.move(i, j);
          break;
        }
      }
    }
    audio.click();
    this.render();
  }

  close(): void {
    for (const c of this.cleanup) c();
    this.el.remove();
  }
}
