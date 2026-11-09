import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ActionResult, LicenseState, Platform } from '../shared/types';
import { EMPTY_LICENSE, type Store } from './store';

const run = promisify(execFile);

/** Same rules as the server: any case, spaces, missing dashes, look-alike letters. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function normalizeKey(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s​-‍﻿"'`]/g, '');
  s = s.replace(/[–—‐-]/g, '');
  if (s.startsWith('DRIFT')) s = s.slice(5);
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 16 || [...s].some((c) => !ALPHABET.includes(c))) return null;
  return `DRIFT-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

/** Read a stable hardware ID for this computer. Never sent as-is: it's hashed first. */
export async function hardwareId(platform: Platform, store: Store): Promise<string> {
  if (process.env.DRIFTSKY_DEVICE_ID) return process.env.DRIFTSKY_DEVICE_ID;
  try {
    if (platform === 'mac') {
      const { stdout } = await run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 5000 });
      const m = stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } else if (platform === 'windows') {
      const { stdout } = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { timeout: 5000, windowsHide: true });
      const m = stdout.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
      if (m) return m[1];
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try {
          const id = fs.readFileSync(f, 'utf8').trim();
          if (id) return id;
        } catch {
          /* next */
        }
      }
    }
  } catch {
    /* fall through to a stored random ID */
  }
  if (!store.data.fallbackId) {
    store.data.fallbackId = crypto.randomUUID();
    store.save();
  }
  return store.data.fallbackId;
}

export function deviceCode(hwid: string) {
  return crypto.createHash('sha256').update(`driftsky:${hwid}`).digest('hex');
}

/** How long the app keeps working without reaching the server. */
export const OFFLINE_GRACE_DAYS = 30;
const OFFLINE = 'Couldn’t reach Driftsky. Check that you’re online and try again.';

type Fetch = typeof fetch;

export class LicenseManager {
  private device: string | null = null;
  constructor(
    private store: Store,
    private api: string,
    private platform: Platform,
    private version: string,
    private onChange: () => void,
    private fetchImpl: Fetch = fetch,
  ) {}

  get state(): LicenseState {
    return this.store.data.license;
  }

  get isLicensed() {
    return this.state.status === 'active';
  }

  private async dev() {
    this.device ??= deviceCode(await hardwareId(this.platform, this.store));
    return this.device;
  }

  private set(l: Partial<LicenseState>) {
    this.store.setLicense({ ...this.state, ...l });
    this.onChange();
  }

  private async post(path: string, body: object): Promise<{ status: number; json: any } | null> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      const r = await this.fetchImpl(`${this.api}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': `Driftsky/${this.version} (${this.platform})` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const json = await r.json().catch(() => ({}));
      return { status: r.status, json };
    } catch {
      return null;
    }
  }

  async activate(input: string): Promise<ActionResult> {
    const key = normalizeKey(input ?? '');
    if (!key) return { ok: false, message: 'That doesn’t look like a Driftsky key. It starts with DRIFT- and has four groups of four characters.' };
    const r = await this.post('/api/license/activate', { key, device: await this.dev(), name: os.hostname().slice(0, 120), platform: this.platform, appVersion: this.version });
    if (!r) return { ok: false, message: OFFLINE };
    if (r.status === 429) return { ok: false, message: r.json.message ?? 'Too many tries. Wait a minute and try again.' };
    if (r.status !== 200 || !r.json.ok) return { ok: false, message: r.json.message ?? 'That key didn’t work. Check it and try again.' };
    const l = r.json.license;
    this.set({ status: 'active', key, email: l.email, seats: l.seats, used: l.used, checkedAt: new Date().toISOString(), message: null });
    return { ok: true, message: r.json.already ? 'This computer already had the key.' : 'Driftsky is unlocked. Enjoy the weather.' };
  }

  /** Free this computer's seat. With force, forget the key locally even if the server can't be reached. */
  async remove(force = false): Promise<ActionResult> {
    const key = this.state.key;
    if (!key) {
      this.set({ ...EMPTY_LICENSE });
      return { ok: true };
    }
    const r = await this.post('/api/license/deactivate', { key, device: await this.dev() });
    if (!r && !force) return { ok: false, message: 'Couldn’t reach Driftsky, so the key is still on this computer. Try again when you’re online, or remove it anyway.' };
    if (r && r.status !== 200 && r.status !== 404 && !force) return { ok: false, message: r.json.message ?? 'Couldn’t remove the key. Try again.' };
    this.set({ ...EMPTY_LICENSE });
    return { ok: true, message: 'The key was removed from this computer. You can paste it on another one now.' };
  }

  /** Periodic check-in. Keeps working offline for a grace period. */
  async validate(): Promise<void> {
    const key = this.state.key;
    if (!key) return;
    const r = await this.post('/api/license/validate', { key, device: await this.dev() });
    if (!r || r.status >= 500 || r.status === 429) {
      // offline or server trouble: fine within the grace period
      const last = this.state.checkedAt ? Date.parse(this.state.checkedAt) : 0;
      const days = (Date.now() - last) / 86_400_000;
      if (this.state.status === 'active' && days > OFFLINE_GRACE_DAYS) {
        this.set({ status: 'invalid', message: `Driftsky hasn’t been able to check your key for ${OFFLINE_GRACE_DAYS} days. Connect to the internet to keep the weather going.` });
      }
      return;
    }
    if (r.json.valid) {
      const l = r.json.license;
      this.set({ status: 'active', email: l.email, seats: l.seats, used: l.used, checkedAt: new Date().toISOString(), message: null });
      return;
    }
    // the key was revoked, or this computer was removed from it elsewhere
    this.set({ status: 'invalid', message: r.json.message ?? 'This key no longer works on this computer.' });
  }

  async upgradeUrl(site: string): Promise<string | null> {
    if (!this.state.key || this.state.seats !== 1) return null;
    return `${site}/api/checkout?plan=upgrade&key=${encodeURIComponent(this.state.key)}&device=${await this.dev()}`;
  }
}
