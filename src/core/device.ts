import type { DeviceMode, Quality } from '../game/settings';

export interface DeviceInfo {
  touch: boolean;
  coarse: boolean;
  fineAvailable: boolean;
  smallScreen: boolean;
  /** Result of AUTO detection. */
  autoMobile: boolean;
  gpu: string;
  cores: number;
  memory: number;
}

/** Capability-based detection (not user-agent based). */
export function detectDevice(): DeviceInfo {
  const mm = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
  const coarse = mm('(pointer: coarse)');
  const fineAvailable = mm('(any-pointer: fine)');
  const shortSide = Math.min(window.screen?.width ?? innerWidth, window.screen?.height ?? innerHeight, innerWidth, innerHeight);
  const smallScreen = shortSide <= 820;
  // Mobile if primary input is touch/coarse, unless a fine pointer (mouse) exists on a large screen.
  const autoMobile = touch && coarse && !(fineAvailable && !smallScreen);
  return {
    touch,
    coarse,
    fineAvailable,
    smallScreen,
    autoMobile,
    gpu: gpuName(),
    cores: navigator.hardwareConcurrency || 4,
    memory: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4,
  };
}

export function resolveMobile(mode: DeviceMode, info: DeviceInfo): boolean {
  if (mode === 'mobile') return true;
  if (mode === 'desktop') return false;
  return info.autoMobile;
}

function gpuName(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'none';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return 'unknown';
  }
}

/**
 * Short, non-intrusive capability check (~30ms of CPU) used to pick a first-launch preset.
 * Combined with hints (cores, memory, GPU string, mobile).
 */
export function benchmarkPreset(info: DeviceInfo, mobile: boolean): Quality {
  const t0 = performance.now();
  let x = 0;
  let iters = 0;
  while (performance.now() - t0 < 30) {
    for (let i = 0; i < 20000; i++) x = (x * 1664525 + 1013904223 + i) % 4294967296;
    iters++;
  }
  const score = iters + (x === -1 ? 1 : 0); // x use prevents dead-code elimination
  const gpu = info.gpu.toLowerCase();
  const softwareGpu = /swiftshader|llvmpipe|software|basic render/.test(gpu);
  if (softwareGpu) return 'low';
  if (mobile) {
    if (info.memory <= 3 || info.cores <= 4 || score < 60) return 'low';
    return 'medium';
  }
  if (info.cores >= 8 && score > 150 && !/intel\(r\) (hd|uhd)/.test(gpu)) return 'high';
  if (score < 50 || info.cores <= 2) return 'low';
  return 'medium';
}
