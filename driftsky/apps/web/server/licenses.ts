import crypto from 'node:crypto';
import { tx, type DB } from './db';
import { PLANS, type PlanId } from './config';

/** Crockford base32 without I, L, O, U: nothing that's easy to misread. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const KEY_PREFIX = 'DRIFT';

export function generateKey(): string {
  const bytes = crypto.randomBytes(16);
  let chars = '';
  for (let i = 0; i < 16; i++) chars += ALPHABET[bytes[i] & 31];
  return `${KEY_PREFIX}-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}

/**
 * Accepts what people paste: any case, extra spaces/newlines, missing or extra dashes, the
 * prefix or not, and look-alike letters (O→0, I/L→1). Returns null if it can't be a key.
 */
export function normalizeKey(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.toUpperCase().replace(/[\s​-‍﻿"'`]/g, '');
  s = s.replace(/[–—‐]/g, '-');
  s = s.replace(/-/g, '');
  if (s.startsWith(KEY_PREFIX)) s = s.slice(KEY_PREFIX.length);
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 16) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return `${KEY_PREFIX}-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

export interface License {
  id: number;
  key: string;
  email: string;
  seats: number;
  plan: string;
  status: 'active' | 'revoked';
  revoked_reason: string | null;
  session_id: string | null;
  payment_intent: string | null;
  created_at: string;
}

export interface Activation {
  id: number;
  license_id: number;
  device: string;
  name: string | null;
  platform: string | null;
  app_version: string | null;
  created_at: string;
  last_seen: string;
}

export type LicenseError = 'not_found' | 'revoked' | 'seats_full' | 'bad_key' | 'bad_device';

export interface LicenseView {
  email: string;
  seats: number;
  used: number;
  plan: string;
}

export class LicenseService {
  constructor(
    private db: DB,
    private deviceSalt: string,
  ) {}

  /** Device IDs arrive already hashed by the app; we hash again with our salt before storing. */
  scramble(device: string) {
    return crypto.createHmac('sha256', this.deviceSalt).update(device).digest('hex');
  }

  byKey(key: string): License | undefined {
    return this.db.prepare('SELECT * FROM licenses WHERE key = ?').get(key) as License | undefined;
  }

  byId(id: number): License | undefined {
    return this.db.prepare('SELECT * FROM licenses WHERE id = ?').get(id) as License | undefined;
  }

  bySession(sessionId: string): License | undefined {
    return this.db.prepare('SELECT * FROM licenses WHERE session_id = ?').get(sessionId) as License | undefined;
  }

  byEmail(email: string): License[] {
    return this.db.prepare("SELECT * FROM licenses WHERE lower(email) = lower(?) AND status = 'active' ORDER BY id").all(email) as unknown as License[];
  }

  activations(licenseId: number): Activation[] {
    return this.db.prepare('SELECT * FROM activations WHERE license_id = ? ORDER BY id').all(licenseId) as unknown as Activation[];
  }

  view(l: License): LicenseView {
    return { email: l.email, seats: l.seats, used: this.activations(l.id).length, plan: l.plan };
  }

  /** Create a license for a completed purchase. Idempotent per checkout session. */
  issue(opts: { email: string; plan: Exclude<PlanId, 'upgrade'>; sessionId?: string; paymentIntent?: string }): { license: License; created: boolean } {
    return tx(this.db, () => {
      if (opts.sessionId) {
        const existing = this.bySession(opts.sessionId);
        if (existing) return { license: existing, created: false };
      }
      let key = generateKey();
      while (this.byKey(key)) key = generateKey();
      const seats = PLANS[opts.plan].seats;
      const r = this.db
        .prepare('INSERT INTO licenses (key, email, seats, plan, session_id, payment_intent) VALUES (?, ?, ?, ?, ?, ?)')
        .run(key, opts.email.trim(), seats, opts.plan, opts.sessionId ?? null, opts.paymentIntent ?? null);
      return { license: this.byId(Number(r.lastInsertRowid))!, created: true };
    });
  }

  /** Raise a 1-computer key to 5 computers. Idempotent. */
  upgrade(licenseId: number, paymentIntent?: string): License | undefined {
    this.db
      .prepare("UPDATE licenses SET seats = MAX(seats, 5), plan = 'five', payment_intent = COALESCE(?, payment_intent), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .run(paymentIntent ?? null, licenseId);
    return this.byId(licenseId);
  }

  revoke(licenseId: number, reason: string) {
    this.db.prepare("UPDATE licenses SET status = 'revoked', revoked_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(reason, licenseId);
  }

  revokeByPaymentIntent(pi: string, reason: string): number {
    const r = this.db.prepare("UPDATE licenses SET status = 'revoked', revoked_reason = ? WHERE payment_intent = ? AND status = 'active'").run(reason, pi);
    return Number(r.changes);
  }

  /** Add this computer to the key. Re-activating the same computer never uses another seat. */
  activate(
    rawKey: unknown,
    device: string,
    meta: { name?: string; platform?: string; appVersion?: string } = {},
  ): { ok: true; license: LicenseView; already: boolean } | { ok: false; error: LicenseError; license?: LicenseView } {
    const key = normalizeKey(rawKey);
    if (!key) return { ok: false, error: 'bad_key' };
    if (!isDevice(device)) return { ok: false, error: 'bad_device' };
    const dev = this.scramble(device);
    return tx(this.db, () => {
      const l = this.byKey(key);
      if (!l) return { ok: false as const, error: 'not_found' as const };
      if (l.status !== 'active') return { ok: false as const, error: 'revoked' as const };
      const existing = this.db.prepare('SELECT id FROM activations WHERE license_id = ? AND device = ?').get(l.id, dev);
      if (existing) {
        this.db
          .prepare("UPDATE activations SET last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now'), name = COALESCE(?, name), platform = COALESCE(?, platform), app_version = COALESCE(?, app_version) WHERE id = ?")
          .run(meta.name ?? null, meta.platform ?? null, meta.appVersion ?? null, (existing as { id: number }).id);
        return { ok: true as const, license: this.view(l), already: true };
      }
      const used = this.activations(l.id).length;
      if (used >= l.seats) return { ok: false as const, error: 'seats_full' as const, license: this.view(l) };
      this.db
        .prepare('INSERT INTO activations (license_id, device, name, platform, app_version) VALUES (?, ?, ?, ?, ?)')
        .run(l.id, dev, meta.name ?? null, meta.platform ?? null, meta.appVersion ?? null);
      return { ok: true as const, license: this.view(l), already: false };
    });
  }

  /** Remove this computer from the key (frees its seat). Idempotent. */
  deactivate(rawKey: unknown, device: string): { ok: true; removed: boolean } | { ok: false; error: LicenseError } {
    const key = normalizeKey(rawKey);
    if (!key) return { ok: false, error: 'bad_key' };
    if (!isDevice(device)) return { ok: false, error: 'bad_device' };
    const l = this.byKey(key);
    if (!l) return { ok: false, error: 'not_found' };
    const r = this.db.prepare('DELETE FROM activations WHERE license_id = ? AND device = ?').run(l.id, this.scramble(device));
    return { ok: true, removed: Number(r.changes) > 0 };
  }

  /** Periodic check-in from the app. */
  validate(rawKey: unknown, device: string): { valid: boolean; reason?: LicenseError | 'not_activated'; license?: LicenseView } {
    const key = normalizeKey(rawKey);
    if (!key) return { valid: false, reason: 'bad_key' };
    if (!isDevice(device)) return { valid: false, reason: 'bad_device' };
    const l = this.byKey(key);
    if (!l) return { valid: false, reason: 'not_found' };
    if (l.status !== 'active') return { valid: false, reason: 'revoked' };
    const r = this.db
      .prepare("UPDATE activations SET last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE license_id = ? AND device = ?")
      .run(l.id, this.scramble(device));
    if (Number(r.changes) === 0) return { valid: false, reason: 'not_activated', license: this.view(l) };
    return { valid: true, license: this.view(l) };
  }
}

/** The app sends a SHA-256 hex digest of its hardware ID. */
export function isDevice(d: unknown): d is string {
  return typeof d === 'string' && /^[a-f0-9]{64}$/.test(d);
}
