import { audio } from './audio/audio';
import { benchmarkPreset, detectDevice, resolveMobile, type DeviceInfo } from './core/device';
import { seedFromString } from './core/noise';
import { Game, type TravelVia } from './game/game';
import { applyPreset, loadSettings, saveSettings, type Settings } from './game/settings';
import { InputManager } from './input/input';
import { TouchControls } from './input/touch';
import { Renderer } from './render/renderer';
import { openStore, type SaveStore } from './save/db';
import { newWorldId, SAVE_VERSION, type GameMode, type WorldMeta } from './save/serialize';
import { Hud } from './ui/hud';
import { initIcons } from './ui/icons';
import { InventoryScreen } from './ui/inventoryScreen';
import { gamepad, glyph, glyphClass, PB, type PadType } from './input/gamepad';
import { PadNav } from './ui/padNav';
import { DIM_NAMES, type Dim } from './world/dimension';
import {
  actions, confirmDialog, deathScreen, goodbyeScreen, el, errorScreen, loadingScreen, mainMenu, MenuBackground, newWorldScreen,
  pauseScreen, promptDialog, rotateOverlay, settingsScreen, toggleFullscreen, worldsScreen,
} from './ui/screens';

type State = 'boot' | 'menu' | 'loading' | 'playing' | 'paused' | 'inventory' | 'dead';

export class App {
  state: State = 'boot';
  settings: Settings;
  device: DeviceInfo;
  mobile: boolean;
  store!: SaveStore;
  r!: Renderer;
  input!: InputManager;
  hud!: Hud;
  touch: TouchControls | null = null;
  game: Game | null = null;
  private ui: HTMLElement;
  private screen: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private bg: MenuBackground | null = null;
  private inv: InventoryScreen | null = null;
  private rotate: HTMLElement | null = null;
  private portraitDismissed = false;
  private expectUnlock = false;
  private clickHint: HTMLElement;
  private loadToken = 0;
  private travelling = false;

  constructor() {
    this.ui = document.getElementById('ui')!;
    this.settings = loadSettings();
    this.device = detectDevice();
    this.mobile = resolveMobile(this.settings.deviceMode, this.device);
    if (!this.settings.benchmarked) {
      const q = benchmarkPreset(this.device, this.mobile);
      this.settings = { ...applyPreset(this.settings, q), benchmarked: true, autoJump: this.mobile };
      console.info(`[BlockForge] first launch: picked '${q}' preset (gpu: ${this.device.gpu}, cores: ${this.device.cores})`);
      saveSettings(this.settings);
    }
    this.clickHint = el(`<div class="click-hint" hidden style="position:absolute;left:50%;top:58%;transform:translateX(-50%);padding:10px 18px;border-radius:8px;background:rgba(10,11,15,.75);font-weight:800;letter-spacing:.14em;pointer-events:none;text-transform:uppercase;font-size:.85rem">Click to play</div>`);
    document.getElementById('app')!.appendChild(this.clickHint);
  }

  async boot(): Promise<void> {
    try {
      this.r = new Renderer(document.getElementById('game') as HTMLCanvasElement);
    } catch (e) {
      this.showScreen(errorScreen('Graphics unavailable', String(e instanceof Error ? e.message : e) + ' Try another browser or enable hardware acceleration.'));
      actions(this.screen!, { reload: () => location.reload() });
      return;
    }
    initIcons(this.r.atlasCanvas);
    this.store = await openStore();
    this.input = new InputManager(this.r.canvas);
    this.hud = new Hud(document.getElementById('hud')!, document.getElementById('touch')!);
    this.touch = new TouchControls(document.getElementById('touch')!, this.input);
    this.hud.initMinimap(this.r.atlasCanvas);
    this.startPadLoop();
    this.applyUiSettings();

    this.input.onEvent((e) => {
      if (e === 'pause') this.onPauseKey();
      else if (e === 'inventory') this.toggleInventory();
      else if (e === 'pointerLockLost') {
        if (this.expectUnlock) this.expectUnlock = false;
        else if (this.state === 'playing') this.pause();
      }
    });
    document.addEventListener('pointerlockchange', () => this.updateClickHint());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        if (this.game) void this.game.save().catch(() => undefined);
        audio.suspend();
      } else audio.resume();
    });
    window.addEventListener('pagehide', () => {
      if (this.game) void this.game.save().catch(() => undefined);
    });
    window.addEventListener('blur', () => {
      if (this.state === 'playing' && this.mobile) this.pause();
    });
    const orient = () => this.updateOrientation();
    window.addEventListener('resize', orient);
    window.addEventListener('orientationchange', () => setTimeout(orient, 200));
    // Unlock audio on the first gesture anywhere (autoplay policy).
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    // Block browser gestures that would zoom/scroll the page during play.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => {
      if (!(e.target as HTMLElement).closest('.scroll, .recipes, .library, .screen')) e.preventDefault();
    }, { passive: false });

    this.exposeDebug();
    this.r.render();
    await this.showMenu();
  }

  private exposeDebug(): void {
    (window as unknown as { __bf: unknown }).__bf = {
      app: this,
      pad: gamepad,
      get state() { return (window as unknown as { __bf: { app: App } }).__bf.app.state; },
    };
  }

  // ---------------- settings ----------------

  private applyUiSettings(): void {
    const s = this.settings;
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
    document.body.classList.toggle('reduced-motion', s.reducedMotion);
    const mobile = resolveMobile(s.deviceMode, this.device);
    if (mobile !== this.mobile) {
      this.mobile = mobile;
      this.touch?.reset();
    }
    document.body.classList.toggle('touch-ui', this.mobile);
    if (this.r) this.r.setQuality(s.resolutionScale, this.mobile);
    audio.setVolumes(s.master, s.effects, s.ambient, s.music);
    gamepad.vibration = s.vibration;
    gamepad.layout = s.padLayout;
    if (this.input) this.input.padSens = s.padSens;
    this.padKey = '';
    this.updateHudVisibility();
  }

  private setSettings(s: Settings): void {
    if (this.mobile && s.renderDistance > 8) s = { ...s, renderDistance: 8 };
    this.settings = s;
    saveSettings(s);
    this.applyUiSettings();
    this.game?.applySettings(s);
  }

  // ---------------- screen management ----------------

  private showScreen(s: HTMLElement | null): void {
    this.screen?.remove();
    this.screen = s;
    if (s) this.ui.appendChild(s);
  }

  private showOverlay(s: HTMLElement | null): void {
    this.overlay?.remove();
    this.overlay = s;
    if (s) this.ui.appendChild(s);
  }

  private updateHudVisibility(): void {
    if (!this.hud) return;
    const inGame = this.state === 'playing' || this.state === 'paused' || this.state === 'inventory' || this.state === 'dead';
    this.hud.show(inGame && this.state !== 'dead');
    this.hud.showTouch(this.state === 'playing' && this.mobile);
    this.updateClickHint();
    this.updateOrientation();
  }

  // ---------------- gamepad ----------------

  private padNav!: PadNav;
  private padBar!: HTMLElement;
  private padHints!: HTMLElement;
  private padKey = '';

  /** One loop owns gamepad polling: gameplay mapping + menu navigation + prompt bars. */
  private startPadLoop(): void {
    this.padNav = new PadNav(this.ui);
    this.padBar = el(`<div class="pad-bar" hidden></div>`);
    this.padHints = el(`<div class="pad-hints" hidden></div>`);
    document.getElementById('app')!.appendChild(this.padBar);
    document.getElementById('hud')!.appendChild(this.padHints);
    const names: Record<PadType, string> = { xbox: 'Xbox controller', playstation: 'PlayStation controller', nintendo: 'Nintendo controller', generic: 'Controller' };
    gamepad.onConnect = (_id, type) => {
      if (this.state !== 'menu' && this.state !== 'boot') this.hud.toast(`${names[type]} connected`);
      else this.flashMenuToast(`${names[type]} connected — use it to navigate`);
    };
    gamepad.onDisconnect = () => {
      if (this.state === 'playing') this.pause();
      this.hud.toast('Controller disconnected', true);
    };
    let last = performance.now();
    const loop = (t: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const s = gamepad.poll();
      this.input.padInventoryOpen = this.state === 'inventory';
      this.input.applyPad(s);
      const navOn = s.connected && gamepad.active && this.state !== 'playing' && this.state !== 'boot' && this.state !== 'loading';
      if (navOn) this.padNav.update(s, dt);
      else this.padNav.clear();
      this.updatePadPrompts(s.connected && gamepad.active);
    };
    requestAnimationFrame(loop);
  }

  private flashMenuToast(msg: string): void {
    const t = el(`<div class="toast" style="position:fixed;left:50%;top:calc(14px + var(--sat));transform:translateX(-50%);z-index:70">${msg}</div>`);
    document.getElementById('app')!.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  private chip(b: number, label: string): string {
    const type = gamepad.type;
    return `<span class="pad-chip"><span class="pg ${glyphClass(type, b)}">${glyph(type, b)}</span>${label}</span>`;
  }

  private updatePadPrompts(active: boolean): void {
    const creative = !!this.game?.creative;
    const key = `${active}|${this.state}|${gamepad.type}|${creative}`;
    if (key === this.padKey) return;
    this.padKey = key;
    document.body.classList.toggle('pad-active', active);
    this.updateClickHint();
    const playing = this.state === 'playing';
    this.padHints.hidden = !(active && playing);
    this.padBar.hidden = !(active && !playing && this.state !== 'boot' && this.state !== 'loading');
    if (active && playing) {
      this.padHints.innerHTML = [
        this.chip(PB.RT, 'Mine'), this.chip(PB.LT, 'Place'), this.chip(PB.SOUTH, 'Jump'),
        this.chip(PB.NORTH, 'Inventory'), this.chip(PB.RB, 'Item'), this.chip(PB.WEST, 'Drop'),
        creative ? this.chip(PB.UP, 'Fly') : this.chip(PB.L3, 'Sprint'),
        creative ? this.chip(PB.EAST, 'Descend') : '', this.chip(PB.START, 'Pause'),
      ].join('');
    } else if (active) {
      this.padBar.innerHTML = [this.chip(PB.SOUTH, 'Select'), this.chip(PB.EAST, 'Back'), this.chip(PB.LB, 'Tabs'), this.state === 'inventory' ? this.chip(PB.WEST, 'Split') : ''].join('');
    }
  }

  private updateClickHint(): void {
    const show = this.state === 'playing' && !this.mobile && !gamepad.active && !this.input?.pointerLocked && !this.input?.useDragFallback;
    this.clickHint.hidden = !show;
  }

  private updateOrientation(): void {
    const portrait = window.innerHeight > window.innerWidth;
    document.body.classList.toggle('portrait', portrait);
    const want = this.mobile && portrait && !this.portraitDismissed && (this.state === 'playing' || this.state === 'paused' || this.state === 'loading');
    if (want && !this.rotate) {
      this.rotate = rotateOverlay();
      actions(this.rotate, {
        continue: () => {
          this.portraitDismissed = true;
          this.updateOrientation();
        },
      });
      this.ui.appendChild(this.rotate);
    } else if (!want && this.rotate) {
      this.rotate.remove();
      this.rotate = null;
    }
  }

  private setState(s: State): void {
    this.state = s;
    if (this.input) this.input.gameplay = s === 'playing';
    if (s !== 'menu' && this.bg) {
      this.bg.stop();
      this.bg = null;
    }
    this.updateHudVisibility();
  }

  // ---------------- menu flows ----------------

  async showMenu(): Promise<void> {
    this.setState('menu');
    this.showOverlay(null);
    let worlds: WorldMeta[] = [];
    try {
      worlds = await this.store.listWorlds();
    } catch (e) {
      console.error('[BlockForge] could not list worlds', e);
    }
    const m = mainMenu(worlds.length > 0, this.store.persistent);
    this.showScreen(m);
    this.bg = new MenuBackground(m);
    actions(m, {
      play: () => (worlds.length ? this.startWorld(worlds[0]) : this.showNewWorld()),
      worlds: () => void this.showWorlds(),
      new: () => this.showNewWorld(),
      settings: () => this.showSettings(() => void this.showMenu()),
      exit: () => this.exitGame(),
    });
  }

  /** Leave the game: drop fullscreen/pointer lock and close the window if the browser allows it. */
  private exitGame(): void {
    this.input.exitPointerLock();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    audio.suspend();
    try {
      window.close();
    } catch {
      /* not allowed */
    }
    // Still here (tabs opened by the user, embedded pages): say goodbye instead.
    setTimeout(() => {
      if (this.state !== 'menu') return;
      this.bg?.stop();
      const g = goodbyeScreen();
      this.showScreen(g);
      actions(g, {
        back: () => {
          audio.resume();
          void this.showMenu();
        },
      });
    }, 250);
  }

  private async showWorlds(): Promise<void> {
    let worlds: WorldMeta[] = [];
    try {
      worlds = await this.store.listWorlds();
    } catch (e) {
      console.error(e);
    }
    const s = worldsScreen(worlds);
    this.showScreen(s);
    const find = (b: HTMLElement) => worlds.find((w) => w.id === (b.closest('[data-id]') as HTMLElement).dataset.id)!;
    actions(s, {
      back: () => void this.showMenu(),
      new: () => this.showNewWorld(),
      playw: (b) => this.startWorld(find(b)),
      delete: (b) => {
        const w = find(b);
        const c = confirmDialog('Delete world?', `“${w.name}” will be permanently deleted. This cannot be undone.`, 'Delete');
        this.showOverlay(c);
        actions(c, {
          cancel: () => this.showOverlay(null),
          ok: async () => {
            this.showOverlay(null);
            try {
              await this.store.deleteWorld(w.id);
            } catch (e) {
              console.error(e);
            }
            void this.showWorlds();
          },
        });
      },
      rename: (b) => {
        const w = find(b);
        const p = promptDialog('Rename world', w.name);
        this.showOverlay(p);
        const input = p.querySelector('input') as HTMLInputElement;
        input.focus();
        input.select();
        const save = async () => {
          const name = input.value.trim().slice(0, 32);
          this.showOverlay(null);
          if (!name) return;
          try {
            await this.store.putWorld({ ...w, name });
          } catch (e) {
            console.error(e);
          }
          void this.showWorlds();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') void save();
        });
        actions(p, { cancel: () => this.showOverlay(null), ok: () => void save() });
      },
    });
  }

  private showNewWorld(): void {
    const s = newWorldScreen();
    this.showScreen(s);
    let mode: GameMode = 'survival';
    const desc = s.querySelector('.mode-desc') as HTMLElement;
    actions(s, {
      back: () => void this.showMenu(),
      mode: (b) => {
        mode = b.dataset.mode as GameMode;
        s.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.mode === mode));
        desc.textContent = mode === 'creative'
          ? 'Unlimited blocks, flight (double-tap jump or F), no hunger or damage.'
          : 'Gather resources, craft tools, stay fed and survive the night.';
      },
      create: () => {
        const name = ((s.querySelector('[name=name]') as HTMLInputElement).value.trim() || 'New World').slice(0, 32);
        let seed = (s.querySelector('[name=seed]') as HTMLInputElement).value.trim();
        if (!seed) seed = String(Math.floor(Math.random() * 2147483647));
        const now = Date.now();
        const meta: WorldMeta = {
          id: newWorldId(), name, seed, seedNum: seedFromString(seed), mode, created: now, lastPlayed: now,
          time: 0.04, day: 0, player: null, version: SAVE_VERSION,
        };
        this.startWorld(meta);
      },
    });
    const nameInput = s.querySelector('[name=name]') as HTMLInputElement;
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (s.querySelector('[data-act=create]') as HTMLElement).click();
    });
  }

  private showSettings(back: () => void): void {
    this.showScreen(settingsScreen(this.settings, this.mobile, (s) => this.setSettings(s), back));
  }

  // ---------------- game flows ----------------

  /** Called from a click handler (user gesture) so fullscreen/audio can start. */
  startWorld(meta: WorldMeta): void {
    audio.unlock();
    if (this.mobile && document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => undefined);
    }
    void this.loadWorld(meta);
  }

  /** Leave the current dimension: save, then load the world again at the destination. */
  private async travel(target: Dim, via: TravelVia): Promise<void> {
    const g = this.game;
    if (!g || this.travelling) return;
    this.travelling = true;
    try {
      g.setPaused(true);
      g.stop();
      await g.save().catch(() => undefined);
      const meta = g.travelMeta(target, via);
      await this.store.putWorld(meta).catch(() => undefined);
      await this.loadWorld(meta);
    } finally {
      this.travelling = false;
    }
  }

  private async loadWorld(meta: WorldMeta): Promise<void> {
    const token = ++this.loadToken;
    this.disposeGame();
    this.setState('loading');
    const ls = loadingScreen();
    this.showScreen(ls);
    const stage = ls.querySelector('.stage') as HTMLElement;
    const bar = ls.querySelector('.bar > i') as HTMLElement;
    const detail = ls.querySelector('[data-detail]') as HTMLElement;
    const dim = meta.dim ?? 'overworld';
    detail.textContent = dim === 'overworld' ? `${meta.name} · seed ${meta.seed}` : `${meta.name} · ${DIM_NAMES[dim]}`;
    if (meta.arrival && meta.arrival !== 'spawn') stage.textContent = `Entering ${DIM_NAMES[dim]}…`;
    this.hud.reset();
    try {
      const game = new Game(meta, this.r, this.input, this.touch, this.hud, this.store, this.settings, this.mobile, {
        onDeath: (reason) => this.onDeath(reason),
        onTravel: (target, via) => void this.travel(target, via),
        onRequestPause: () => this.pause(),
        onRequestInventory: () => this.openInventory(),
        onFatal: (e) => this.fatal(e),
      });
      this.game = game;
      await game.load((st, f) => {
        stage.textContent = st;
        bar.style.width = `${Math.round(f * 100)}%`;
      });
      if (token !== this.loadToken) return;
      this.showScreen(null);
      game.setPaused(false);
      this.setState('playing');
      game.start();
      if (!this.mobile) this.input.requestPointerLock();
      if (!this.store.persistent) this.hud.toast('Storage unavailable: this world will not be saved', true, 5000);
      if (!meta.player) this.showFirstHints(meta.mode);
    } catch (e) {
      if (token !== this.loadToken) return;
      console.error('[BlockForge] failed to load world', e);
      this.disposeGame();
      this.setState('menu');
      const err = errorScreen('Could not load world', e instanceof Error ? e.message : String(e));
      this.showScreen(err);
      actions(err, { reload: () => void this.showMenu() });
      (err.querySelector('[data-act=reload]') as HTMLElement).textContent = 'Back to menu';
    }
  }

  /** Short onboarding for a brand-new world. */
  private showFirstHints(mode: GameMode): void {
    const m = this.mobile;
    const hints = mode === 'creative'
      ? [m ? 'Tap ▦ for the Block Library. Fly with the wing button.' : 'Press E for the Block Library. Double-tap Space or F to fly.']
      : [
          m ? 'Hold ⛏ while aiming at a tree to collect logs.' : 'Hold left click on a tree to collect logs.',
          m ? 'Open ▦ to craft planks, sticks and a Forge Bench.' : 'Press E to craft planks, sticks and a Forge Bench.',
          'Nights bring Shadow Crawlers — build shelter and keep fed!',
        ];
    hints.forEach((h, i) => setTimeout(() => this.state === 'playing' && this.hud.toast(h, false, 6000), 1200 + i * 6500));
  }

  private disposeGame(): void {
    if (this.inv) {
      this.inv.close();
      this.inv = null;
    }
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
  }

  private onPauseKey(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused' && this.screen?.dataset.screen === 'pause') this.resume();
    else if (this.state === 'paused' && this.screen?.dataset.screen === 'settings') this.showPause();
    else if (this.state === 'inventory') this.closeInventory();
  }

  pause(): void {
    if (!this.game || this.state !== 'playing') return;
    this.game.setPaused(true);
    this.setState('paused');
    this.expectUnlock = true;
    this.input.exitPointerLock();
    if (!document.pointerLockElement) this.expectUnlock = false;
    this.showPause();
  }

  private showPause(): void {
    const p = pauseScreen(!!this.game?.creative);
    this.showScreen(p);
    actions(p, {
      resume: () => this.resume(),
      settings: () => this.showSettings(() => this.showPause()),
      fullscreen: () => toggleFullscreen(),
      savequit: () => void this.saveAndQuit(),
      mode: () => {
        if (!this.game) return;
        this.game.setMode(this.game.creative ? 'survival' : 'creative');
        this.showPause();
      },
    });
  }

  resume(): void {
    if (!this.game) return;
    this.showScreen(null);
    this.game.setPaused(false);
    this.setState('playing');
    if (!this.mobile) this.input.requestPointerLock();
  }

  private async saveAndQuit(): Promise<void> {
    const g = this.game;
    if (!g) return;
    const btn = this.screen?.querySelector('[data-act=savequit]') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving…';
    }
    try {
      await g.save();
    } catch {
      // toast already shown; still let the player leave
    }
    this.disposeGame();
    await this.showMenu();
  }

  private toggleInventory(): void {
    if (this.state === 'playing') this.openInventory();
    else if (this.state === 'inventory') this.closeInventory();
  }

  openInventory(): void {
    if (!this.game || this.state !== 'playing') return;
    this.setState('inventory');
    this.expectUnlock = !!document.pointerLockElement;
    this.input.exitPointerLock();
    this.touch?.reset();
    audio.openInventory();
    this.inv = new InventoryScreen(this.ui, this.game, () => this.closeInventory());
  }

  closeInventory(): void {
    if (this.state !== 'inventory') return;
    this.inv?.close();
    this.inv = null;
    this.setState('playing');
    if (!this.mobile) this.input.requestPointerLock();
  }

  private onDeath(reason: string): void {
    if (this.inv) {
      this.inv.close();
      this.inv = null;
    }
    this.setState('dead');
    this.expectUnlock = !!document.pointerLockElement;
    this.input.exitPointerLock();
    const d = deathScreen(reason);
    this.showScreen(d);
    actions(d, {
      respawn: () => {
        if (!this.game) return;
        if (this.game.dim !== 'overworld') {
          // Death in another dimension: respawn at the overworld spawn point.
          void this.travel('overworld', 'respawn');
          return;
        }
        this.game.respawn();
        this.showScreen(null);
        this.game.setPaused(false);
        this.setState('playing');
        if (!this.mobile) this.input.requestPointerLock();
      },
      menu: () => void this.saveAndQuit(),
    });
  }

  private fatal(e: unknown): void {
    console.error('[BlockForge] fatal runtime error', e);
    const g = this.game;
    if (g) void g.save().catch(() => undefined);
    this.setState('menu');
    const s = errorScreen('Something went wrong', `${e instanceof Error ? e.message : String(e)} — your world was saved.`);
    this.showScreen(s);
    actions(s, {
      reload: () => {
        this.disposeGame();
        void this.showMenu();
      },
    });
    (s.querySelector('[data-act=reload]') as HTMLElement).textContent = 'Back to menu';
  }
}
