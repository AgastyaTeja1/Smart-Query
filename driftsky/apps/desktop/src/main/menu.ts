import { EFFECT_INFO, EFFECTS, WALLPAPERS, type EffectId, type WallpaperId } from '@driftsky/engine';
import type { AppState } from '../shared/types';

/** Menu items as plain data, so the tray menu can be unit-tested without Electron. */
export interface MenuSpec {
  id?: string;
  label?: string;
  type?: 'normal' | 'separator' | 'radio' | 'checkbox' | 'submenu';
  checked?: boolean;
  enabled?: boolean;
  accelerator?: string;
  submenu?: MenuSpec[];
  action?: MenuAction;
}

export type MenuAction =
  | { kind: 'effect'; effect: EffectId | 'off' }
  | { kind: 'wallpaper'; wallpaper: WallpaperId }
  | { kind: 'intensity'; value: number }
  | { kind: 'toggle'; setting: 'behindWindows' }
  | { kind: 'open'; tab: 'effects' | 'wallpapers' | 'license' | 'settings' | 'about' }
  | { kind: 'buy' }
  | { kind: 'upgrade' }
  | { kind: 'preview' }
  | { kind: 'update' }
  | { kind: 'check-updates' }
  | { kind: 'quit' };

export const INTENSITIES = [
  { label: 'Light', value: 0.5 },
  { label: 'Normal', value: 1 },
  { label: 'Heavy', value: 1.6 },
];

export function statusLine(s: AppState): string {
  if (s.license.status !== 'active' && !s.preview.active) return s.license.status === 'invalid' ? 'Driftsky needs your key' : 'Driftsky: add your key to start';
  if (s.settings.effect === 'off') return 'Driftsky is off';
  const name = EFFECT_INFO[s.settings.effect as EffectId].name;
  if (s.paused === 'fullscreen') return `${name} · paused for full screen`;
  if (s.paused) return `${name} · paused`;
  if (s.preview.active) return `${name} · preview`;
  return s.onBattery && s.settings.batterySaver ? `${name} · battery saver` : `${name}`;
}

export function buildMenu(s: AppState): MenuSpec[] {
  const licensed = s.license.status === 'active';
  const cmd = s.platform === 'mac' ? 'Command' : 'Ctrl';
  const items: MenuSpec[] = [{ id: 'status', label: statusLine(s), enabled: false }, { type: 'separator' }];

  for (const id of EFFECTS) {
    items.push({ id: `effect-${id}`, label: EFFECT_INFO[id].name, type: 'radio', checked: s.settings.effect === id, enabled: licensed || s.preview.active, action: { kind: 'effect', effect: id } });
  }
  items.push({ id: 'effect-off', label: 'Off', type: 'radio', checked: s.settings.effect === 'off', enabled: licensed || s.preview.active, action: { kind: 'effect', effect: 'off' } });
  items.push({ type: 'separator' });

  items.push({
    id: 'wallpaper',
    label: 'Wallpaper',
    type: 'submenu',
    submenu: WALLPAPERS.map((w) => ({ id: `wallpaper-${w.id}`, label: w.name, type: 'radio', checked: s.settings.wallpaper === w.id, action: { kind: 'wallpaper', wallpaper: w.id } })),
  });
  items.push({
    id: 'intensity',
    label: 'Amount',
    type: 'submenu',
    submenu: INTENSITIES.map((i) => ({ id: `intensity-${i.label.toLowerCase()}`, label: i.label, type: 'radio', checked: Math.abs(s.settings.intensity - i.value) < 0.01, action: { kind: 'intensity', value: i.value } })),
  });
  items.push({ id: 'behind', label: 'Behind windows', type: 'checkbox', checked: s.settings.behindWindows, action: { kind: 'toggle', setting: 'behindWindows' } });
  items.push({ type: 'separator' });

  if (licensed) {
    const seats = s.license.seats ?? 1;
    items.push({ id: 'license', label: `${s.license.email ?? 'Licensed'} · ${seats === 1 ? '1 computer' : `${s.license.used ?? 1} of ${seats} computers`}`, enabled: false });
    if (seats === 1) items.push({ id: 'upgrade', label: 'Upgrade to 5 computers…', action: { kind: 'upgrade' } });
  } else {
    items.push({ id: 'enter-key', label: 'Enter license key…', action: { kind: 'open', tab: 'license' } });
    if (!s.preview.used && !s.preview.active) items.push({ id: 'preview', label: 'Try it for a minute', action: { kind: 'preview' } });
    items.push({ id: 'buy', label: 'Buy Driftsky…', action: { kind: 'buy' } });
  }
  items.push({ type: 'separator' });

  if (s.update.status === 'available' || s.update.status === 'ready') items.push({ id: 'update', label: `Update to ${s.update.version}…`, action: { kind: 'update' } });
  else if (s.update.status === 'downloading') items.push({ id: 'update', label: `Downloading update… ${Math.round((s.update.progress ?? 0) * 100)}%`, enabled: false });
  else items.push({ id: 'check-updates', label: 'Check for updates', action: { kind: 'check-updates' } });
  items.push({ id: 'settings', label: 'Settings…', accelerator: `${cmd}+,`, action: { kind: 'open', tab: 'effects' } });
  items.push({ id: 'quit', label: 'Quit Driftsky', accelerator: `${cmd}+Q`, action: { kind: 'quit' } });
  return items;
}
