export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type DeviceMode = 'auto' | 'desktop' | 'mobile';
export type PadLayoutSetting = 'auto' | 'xbox' | 'playstation' | 'nintendo';

export interface Settings {
  renderDistance: number;
  quality: Quality;
  ao: boolean;
  particles: 'off' | 'low' | 'high';
  clouds: boolean;
  fov: number;
  resolutionScale: number;
  mouseSens: number;
  touchSens: number;
  padSens: number;
  vibration: boolean;
  padLayout: PadLayoutSetting;
  invertY: boolean;
  master: number;
  effects: number;
  ambient: number;
  music: number;
  showMap: boolean;
  /** Name of the block/creature under the crosshair. */
  showNames: boolean;
  deviceMode: DeviceMode;
  uiScale: number;
  showDebug: boolean;
  adaptive: boolean;
  autoJump: boolean;
  reducedMotion: boolean;
  /** Set after first-launch capability check. */
  benchmarked: boolean;
}

export const RENDER_DISTANCES = [3, 4, 6, 8, 10, 12, 16];

export const PRESETS: Record<Quality, Pick<Settings, 'renderDistance' | 'ao' | 'particles' | 'clouds' | 'resolutionScale'>> = {
  low: { renderDistance: 4, ao: false, particles: 'low', clouds: false, resolutionScale: 0.75 },
  medium: { renderDistance: 6, ao: true, particles: 'low', clouds: true, resolutionScale: 1 },
  high: { renderDistance: 8, ao: true, particles: 'high', clouds: true, resolutionScale: 1 },
  ultra: { renderDistance: 12, ao: true, particles: 'high', clouds: true, resolutionScale: 1 },
};

export function defaultSettings(): Settings {
  return {
    ...PRESETS.medium,
    quality: 'medium',
    fov: 75,
    mouseSens: 1,
    touchSens: 1,
    padSens: 1,
    vibration: true,
    padLayout: 'auto',
    invertY: false,
    master: 0.8,
    effects: 0.9,
    ambient: 0.6,
    music: 0.5,
    showMap: true,
    showNames: true,
    deviceMode: 'auto',
    uiScale: 1,
    showDebug: false,
    adaptive: true,
    autoJump: true,
    reducedMotion: false,
    benchmarked: false,
  };
}

function clamp(v: unknown, lo: number, hi: number, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
}

/** Validate + merge raw (possibly corrupted) settings over defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], def: T): T => (allowed.includes(v as T) ? (v as T) : def);
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  return {
    renderDistance: Math.round(clamp(r.renderDistance, 2, 16, d.renderDistance)),
    quality: pick(r.quality, ['low', 'medium', 'high', 'ultra'] as const, d.quality),
    ao: bool(r.ao, d.ao),
    particles: pick(r.particles, ['off', 'low', 'high'] as const, d.particles),
    clouds: bool(r.clouds, d.clouds),
    fov: clamp(r.fov, 50, 110, d.fov),
    resolutionScale: clamp(r.resolutionScale, 0.4, 1, d.resolutionScale),
    mouseSens: clamp(r.mouseSens, 0.1, 4, d.mouseSens),
    touchSens: clamp(r.touchSens, 0.1, 4, d.touchSens),
    padSens: clamp(r.padSens, 0.2, 3, d.padSens),
    vibration: bool(r.vibration, d.vibration),
    padLayout: pick(r.padLayout, ['auto', 'xbox', 'playstation', 'nintendo'] as const, d.padLayout),
    invertY: bool(r.invertY, d.invertY),
    master: clamp(r.master, 0, 1, d.master),
    effects: clamp(r.effects, 0, 1, d.effects),
    ambient: clamp(r.ambient, 0, 1, d.ambient),
    music: clamp(r.music, 0, 1, d.music),
    showMap: bool(r.showMap, d.showMap),
    showNames: bool(r.showNames, d.showNames),
    deviceMode: pick(r.deviceMode, ['auto', 'desktop', 'mobile'] as const, d.deviceMode),
    uiScale: clamp(r.uiScale, 0.75, 1.5, d.uiScale),
    showDebug: bool(r.showDebug, d.showDebug),
    adaptive: bool(r.adaptive, d.adaptive),
    autoJump: bool(r.autoJump, d.autoJump),
    reducedMotion: bool(r.reducedMotion, d.reducedMotion),
    benchmarked: bool(r.benchmarked, d.benchmarked),
  };
}

export function applyPreset(s: Settings, q: Quality): Settings {
  return { ...s, ...PRESETS[q], quality: q };
}

const KEY = 'blockforge.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings live for this session only */
  }
}
