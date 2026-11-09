import { PLANS, type Config, type PlanId } from './config';
import type { DB } from './db';
import { LicenseService, normalizeKey, type License } from './licenses';
import { keysReminderEmail, licenseEmail, offerEmail, upgradeEmail, type Mailer } from './mailer';
import type { PaymentProvider } from './payments';

export interface SessionRow {
  id: string;
  provider: string;
  plan: PlanId;
  email: string | null;
  upgrade_license_id: number | null;
  status: 'open' | 'paid' | 'expired';
  license_id: number | null;
}

/**
 * Turns paid checkouts into keys and emails. Every step is idempotent so Stripe retries,
 * duplicate events and a success-page race can't create two keys or two emails.
 */
export class Orders {
  constructor(
    private db: DB,
    private licenses: LicenseService,
    private mailer: Mailer,
    private payments: PaymentProvider,
    private cfg: Pick<Config, 'PUBLIC_URL' | 'SUPPORT_EMAIL'>,
  ) {}

  recordSession(id: string, plan: PlanId, provider: string, upgradeLicenseId?: number, email?: string) {
    this.db
      .prepare('INSERT OR IGNORE INTO checkout_sessions (id, provider, plan, upgrade_license_id, email) VALUES (?, ?, ?, ?, ?)')
      .run(id, provider, plan, upgradeLicenseId ?? null, email ?? null);
  }

  session(id: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM checkout_sessions WHERE id = ?').get(id) as SessionRow | undefined;
  }

  /** A checkout was paid. */
  async fulfil(p: { sessionId: string; plan: string | undefined; email: string; paymentIntent?: string; upgradeKey?: string }): Promise<License | null> {
    const email = p.email.trim();
    const known = this.session(p.sessionId);
    const plan = (known?.plan ?? p.plan) as PlanId | undefined;
    if (!plan || !(plan in PLANS)) throw new Error(`unknown plan for session ${p.sessionId}`);
    if (known?.status === 'paid' && known.license_id) return this.licenses.byId(known.license_id) ?? null;

    let license: License | undefined;
    if (plan === 'upgrade') {
      const target = known?.upgrade_license_id ? this.licenses.byId(known.upgrade_license_id) : p.upgradeKey ? this.licenses.byKey(normalizeKey(p.upgradeKey) ?? '') : undefined;
      if (!target) throw new Error(`upgrade target missing for ${p.sessionId}`);
      const before = target.seats;
      license = this.licenses.upgrade(target.id, p.paymentIntent);
      if (license && before < license.seats) await this.mail(license.email, upgradeEmail({ key: license.key, support: this.cfg.SUPPORT_EMAIL }));
    } else {
      const r = this.licenses.issue({ email, plan, sessionId: p.sessionId, paymentIntent: p.paymentIntent });
      license = r.license;
      if (r.created) await this.mail(email, licenseEmail({ key: license.key, seats: license.seats, publicUrl: this.cfg.PUBLIC_URL, support: this.cfg.SUPPORT_EMAIL }));
    }
    this.recordSession(p.sessionId, plan, this.payments.name);
    this.db.prepare("UPDATE checkout_sessions SET status = 'paid', email = ?, license_id = ? WHERE id = ?").run(email, license?.id ?? null, p.sessionId);
    return license ?? null;
  }

  /** Checkout expired unpaid: one 20% offer email per address, only with consent. */
  async expired(p: { sessionId: string; email?: string | null; consent?: boolean; plan?: string }) {
    this.db.prepare("UPDATE checkout_sessions SET status = 'expired' WHERE id = ? AND status = 'open'").run(p.sessionId);
    if (!p.email || !p.consent) return false;
    const plan = (this.session(p.sessionId)?.plan ?? p.plan) as PlanId | undefined;
    if (plan === 'upgrade') return false;
    // already a customer, or already offered: don't nag
    if (this.licenses.byEmail(p.email).length) return false;
    const claimed = this.db.prepare('INSERT OR IGNORE INTO offers (email) VALUES (lower(?))').run(p.email);
    if (Number(claimed.changes) === 0) return false;
    const code = await this.payments.createOffer(p.email);
    if (!code) return false;
    this.db.prepare('UPDATE offers SET code = ? WHERE email = lower(?)').run(code, p.email);
    await this.mail(p.email, offerEmail({ code, plan: PLANS[plan && plan in PLANS ? plan : 'one'].label, publicUrl: this.cfg.PUBLIC_URL }));
    return true;
  }

  async resendKeys(email: string) {
    const keys = this.licenses.byEmail(email);
    if (!keys.length) return false;
    await this.mail(keys[0].email, keysReminderEmail({ keys: keys.map((k) => ({ key: k.key, seats: k.seats })), support: this.cfg.SUPPORT_EMAIL }));
    return true;
  }

  private async mail(to: string, m: { subject: string; text: string; html: string }) {
    try {
      await this.mailer.send({ to, ...m });
    } catch (e) {
      // the key exists either way; the success page shows it and support can resend
      console.error('[mail] failed to send to', to, (e as Error).message);
    }
  }
}
