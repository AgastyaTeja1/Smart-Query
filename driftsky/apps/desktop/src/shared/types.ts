import type { EffectId, WallpaperId } from '@driftsky/engine';

export type Platform = 'mac' | 'windows' | 'linux';

export interface Settings {
  effect: EffectId | 'off';
  /** Last effect that wasn't "off", so the tray toggle can bring it back. */
  lastEffect: EffectId;
  wallpaper: WallpaperId | null;
  /** 0.5 light · 1 normal · 1.6 heavy */
  intensity: number;
  behindWindows: boolean;
  openAtLogin: boolean;
  batterySaver: boolean;
  pauseInFullScreen: boolean;
  autoUpdate: boolean;
  onboarded: boolean;
}

export type LicenseStatus = 'none' | 'active' | 'invalid';

export interface LicenseState {
  status: LicenseStatus;
  key: string | null;
  email: string | null;
  seats: number | null;
  used: number | null;
  /** ISO time of the last successful check with the server. */
  checkedAt: string | null;
  /** Shown in the License tab when something needs attention. */
  message: string | null;
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error';
  version: string | null;
  notes: string | null;
  progress: number | null;
  message: string | null;
  /** The running version is below the server's minimum. */
  required: boolean;
}

export interface PreviewState {
  /** Unlicensed users can try any effect for a short while. */
  active: boolean;
  endsAt: number | null;
  used: boolean;
}

export interface AppState {
  version: string;
  platform: Platform;
  settings: Settings;
  license: LicenseState;
  update: UpdateState;
  preview: PreviewState;
  /** Effects are actually showing (licensed or previewing, not paused). */
  running: boolean;
  paused: null | 'locked' | 'suspended' | 'asleep' | 'fullscreen';
  onBattery: boolean;
  /** macOS Low Power Mode is on. */
  lowPowerMode: boolean;
  /** "Behind windows" is only offered where it works properly (macOS). */
  canGoBehind: boolean;
  links: { site: string; buy: string; privacy: string; terms: string; lostKey: string; support: string };
}

/** What the main process sends each overlay, in that display's local coordinates. */
export interface WorldFrame {
  windows: Array<{ id: string; x: number; y: number; w: number; h: number }>;
  floor: { x: number; y: number; w: number; h: number } | null;
  pointer: { x: number; y: number } | null;
}

export interface OverlayConfig {
  effect: EffectId | 'off';
  intensity: number;
  lowPower: boolean;
  paused: boolean;
}

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };
