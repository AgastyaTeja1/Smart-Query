import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { EFFECTS, WALLPAPERS } from '@driftsky/engine';
import type { LicenseState, Settings } from '../shared/types';

const effectIds = EFFECTS as unknown as [string, ...string[]];
const wallpaperIds = WALLPAPERS.map((w) => w.id) as unknown as [string, ...string[]];

export const settingsSchema = z.object({
  effect: z.enum([...effectIds, 'off'] as [string, ...string[]]).catch('snow'),
  lastEffect: z.enum(effectIds).catch('snow'),
  wallpaper: z.enum(wallpaperIds).nullable().catch(null),
  intensity: z.number().min(0.25).max(2).catch(1),
  behindWindows: z.boolean().catch(false),
  openAtLogin: z.boolean().catch(true),
  batterySaver: z.boolean().catch(true),
  pauseInFullScreen: z.boolean().catch(true),
  autoUpdate: z.boolean().catch(true),
  onboarded: z.boolean().catch(false),
});

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({}) as Settings;

const licenseSchema = z.object({
  status: z.enum(['none', 'active', 'invalid']).catch('none'),
  key: z.string().nullable().catch(null),
  email: z.string().nullable().catch(null),
  seats: z.number().nullable().catch(null),
  used: z.number().nullable().catch(null),
  checkedAt: z.string().nullable().catch(null),
  message: z.string().nullable().catch(null),
});

export const EMPTY_LICENSE: LicenseState = licenseSchema.parse({}) as LicenseState;

interface Persisted {
  settings: Settings;
  license: LicenseState;
  preview: { used: boolean };
  /** Random ID used when the hardware ID can't be read. */
  fallbackId?: string;
}

/**
 * A small JSON store in the app's data folder. Writes are atomic (temp file + rename) so a crash
 * mid-write can't leave a corrupt file, and anything unreadable falls back to defaults.
 */
export class Store {
  private file: string;
  data: Persisted;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'driftsky.json');
    this.data = this.read();
  }

  private read(): Persisted {
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) raw = {};
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        // keep the broken file around for support, start fresh
        try {
          fs.renameSync(this.file, this.file + '.broken');
        } catch {
          /* ignore */
        }
      }
    }
    const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    return {
      settings: settingsSchema.parse(obj(raw.settings)) as Settings,
      license: licenseSchema.parse(obj(raw.license)) as LicenseState,
      preview: { used: !!(raw.preview as { used?: boolean } | undefined)?.used },
      fallbackId: typeof raw.fallbackId === 'string' ? raw.fallbackId : undefined,
    };
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** Merge a partial update, validating every field. Returns the new settings. */
  updateSettings(patch: Partial<Settings>): Settings {
    const next = settingsSchema.parse({ ...this.data.settings, ...patch }) as Settings;
    if (next.effect !== 'off') next.lastEffect = next.effect as Settings['lastEffect'];
    this.data.settings = next;
    this.save();
    return next;
  }

  setLicense(l: LicenseState) {
    this.data.license = licenseSchema.parse(l) as LicenseState;
    this.save();
  }
}
