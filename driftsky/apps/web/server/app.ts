import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PLANS, type Config, type PlanId } from './config';
import type { DB } from './db';
import { LicenseService, normalizeKey, type LicenseError } from './licenses';
import type { Mailer } from './mailer';
import { Orders } from './orders';
import { verifyStripeSignature, type PaymentProvider } from './payments';
import { rateLimit } from './ratelimit';
import type { ReleaseStore } from './releases';

export interface AppDeps {
  cfg: Config;
  db: DB;
  payments: PaymentProvider;
  mailer: Mailer;
  releases: ReleaseStore;
}

/** Human messages for license errors, shown as-is in the app. */
export const LICENSE_MESSAGES: Record<LicenseError | 'not_activated' | 'bad_request', string> = {
  bad_key: 'That doesn’t look like a Driftsky key. It starts with DRIFT- and has four groups of four.',
  not_found: 'We couldn’t find that key. Check it was copied in full from the email.',
  revoked: 'This key has been turned off. Write to support if you think that’s a mistake.',
  seats_full: 'This key is already on as many computers as it covers. Remove it from one of them in the app, then try again.',
  bad_device: 'Something went wrong identifying this computer. Restart Driftsky and try again.',
  not_activated: 'This computer was removed from the key. Paste the key again to add it back.',
  bad_request: 'Something in that request wasn’t right. Update Driftsky and try again.',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Minimal standalone page for server-rendered messages (downloads, checkout errors). */
export function messagePage(title: string, body: string, link = { href: '/', label: 'Back to Driftsky' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Driftsky</title>
<link rel="icon" href="/icon.svg"><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Inter,'Helvetica Neue',Arial,sans-serif;background:#fff;color:#0b0b10;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
main{max-width:440px;text-align:center}h1{font-size:28px;letter-spacing:-.6px;margin:0 0 12px}p{color:#6e6e73;line-height:1.55;margin:0 0 24px}
a.btn{display:inline-block;background:#1f6fe0;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:500}
@media (prefers-color-scheme:dark){body{background:#0b0b10;color:#f5f5f7}p{color:#a1a1a6}}</style></head>
<body><main><h1>${esc(title)}</h1><p>${body}</p><a class="btn" href="${esc(link.href)}">${esc(link.label)}</a></main></body></html>`;
}

const deviceSchema = z.string().regex(/^[a-f0-9]{64}$/);
const activateBody = z.object({
  key: z.string().max(200),
  device: deviceSchema,
  name: z.string().max(120).optional(),
  platform: z.enum(['mac', 'windows', 'linux']).optional(),
  appVersion: z.string().max(32).optional(),
});
const keyDeviceBody = z.object({ key: z.string().max(200), device: deviceSchema });

/** Name the field that's actually wrong. */
function inputError(body: unknown): LicenseError | 'bad_request' {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.key !== 'string' || !normalizeKey(b.key)) return 'bad_key';
  if (!deviceSchema.safeParse(b.device).success) return 'bad_device';
  return 'bad_request';
}

export function createApp(deps: AppDeps) {
  const { cfg, db, payments, mailer, releases } = deps;
  const licenses = new LicenseService(db, cfg.DEVICE_SALT);
  const orders = new Orders(db, licenses, mailer, payments, cfg);
  const app = express();
  app.disable('x-powered-by');
  if (cfg.TRUST_PROXY) app.set('trust proxy', 1);
  const isProd = cfg.NODE_ENV === 'production';
  /** Test helpers (outbox, limit reset) exist outside production, or on an explicitly mock-payment staging deploy. */
  const devRoutes = payments.name === 'mock' && (!isProd || cfg.ALLOW_MOCK_PAYMENTS);

  const limits = {
    license: rateLimit({ windowMs: 60_000, max: 30, name: 'license' }),
    checkout: rateLimit({ windowMs: 60_000, max: 20, name: 'checkout' }),
    resend: rateLimit({ windowMs: 60 * 60_000, max: 5, name: 'resend' }),
    // the thank-you page polls this while a payment confirms
    session: rateLimit({ windowMs: 60_000, max: 120, name: 'session' }),
  };

  let warnedProxy = false;
  app.use((req, res, next) => {
    if (isProd && !cfg.TRUST_PROXY && !warnedProxy && req.headers['x-forwarded-for']) {
      warnedProxy = true;
      console.warn('[warning] requests arrive through a proxy but TRUST_PROXY is off: every visitor shares one rate limit. Set TRUST_PROXY=1.');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' https://us-assets.i.posthog.com; connect-src 'self' https://us.i.posthog.com https://us-assets.i.posthog.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com",
      );
    }
    next();
  });

  // ---- Stripe webhook: needs the raw body, so it's registered before the JSON parser ----
  app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const raw = req.body as Buffer;
    if (!cfg.STRIPE_WEBHOOK_SECRET || !verifyStripeSignature(raw, req.header('stripe-signature'), cfg.STRIPE_WEBHOOK_SECRET)) {
      return res.status(400).json({ error: 'bad_signature' });
    }
    let event: { id: string; type: string; data: { object: Record<string, any> } };
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'bad_json' });
    }
    if (!event || typeof event !== 'object' || typeof event.id !== 'string' || typeof event.type !== 'string') {
      return res.status(400).json({ error: 'bad_event' });
    }
    try {
      const seen = db.prepare('SELECT 1 FROM webhook_events WHERE id = ?').get(event.id);
      if (seen) return res.json({ received: true, duplicate: true });
      const o = event.data?.object && typeof event.data.object === 'object' ? event.data.object : {};
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          // 'no_payment_required': a 100%-off promotion code still earns a key
          if (o.payment_status === 'paid' || o.payment_status === 'no_payment_required' || event.type === 'checkout.session.async_payment_succeeded') {
            const email = o.customer_details?.email ?? o.customer_email;
            if (!email) throw new Error(`no email on session ${o.id}`);
            await orders.fulfil({
              sessionId: o.id,
              plan: o.metadata?.plan,
              email,
              paymentIntent: o.payment_intent ?? undefined,
              upgradeKey: o.metadata?.upgrade_key,
            });
          }
          break;
        case 'checkout.session.expired':
          await orders.expired({
            sessionId: o.id,
            email: o.customer_details?.email ?? o.customer_email,
            consent: o.consent?.promotions === 'opt_in',
            plan: o.metadata?.plan,
          });
          break;
        case 'charge.refunded':
          if (typeof o.payment_intent === 'string' && (o.refunded || o.amount_refunded >= o.amount)) licenses.refundPayment(o.payment_intent, 'refunded');
          break;
        case 'charge.dispute.created':
          if (typeof o.payment_intent === 'string') licenses.refundPayment(o.payment_intent, 'disputed');
          break;
        case 'charge.dispute.closed':
          // we won the dispute: the purchase stands, so the key works again
          if (typeof o.payment_intent === 'string' && o.status === 'won') licenses.reinstateDisputed(o.payment_intent);
          break;
        default:
          break;
      }
      db.prepare('INSERT OR IGNORE INTO webhook_events (id, type) VALUES (?, ?)').run(event.id, event.type);
      res.json({ received: true });
    } catch (e) {
      console.error('[webhook]', event.type, (e as Error).message);
      // non-2xx makes Stripe retry later
      res.status(500).json({ error: 'processing_failed' });
    }
  });

  app.use(express.json({ limit: '16kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // ---- releases & downloads ----
  app.get('/api/app', (req, res) => {
    const platform = req.query.platform === 'windows' ? 'windows' : 'mac';
    const r = releases.for(platform);
    if (!r) return res.status(404).json({ error: 'no_release' });
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ latest: r.latest, minimum: r.minimum, url: r.url, sha256: r.sha256, notes: r.notes ?? null });
  });

  const download = (platform: 'mac' | 'windows') => (_req: Request, res: Response) => {
    const r = releases.for(platform);
    if (!r) {
      return res
        .status(503)
        .type('html')
        .send(
          messagePage(
            'Almost ready',
            `The ${platform === 'mac' ? 'Mac' : 'Windows'} download isn’t up yet. Check back soon, or write to ${esc(cfg.SUPPORT_EMAIL)}.`,
          ),
        );
    }
    res.redirect(302, r.download ?? r.url);
  };
  app.get('/download', download('mac'));
  app.get('/download/mac', download('mac'));
  app.get('/download/windows', download('windows'));
  if (cfg.FILES_DIR) app.use('/files', express.static(path.resolve(cfg.FILES_DIR), { fallthrough: false, dotfiles: 'deny' }));

  // ---- checkout ----
  app.get('/api/checkout', limits.checkout, async (req, res, next) => {
    try {
      const plan = String(req.query.plan ?? '') as PlanId;
      if (!Object.hasOwn(PLANS, plan))
        return res
          .status(400)
          .type('html')
          .send(messagePage('Pick a plan', 'That plan doesn’t exist.', { href: '/#pricing', label: 'See pricing' }));
      let upgradeLicenseId: number | undefined;
      let upgradeKey: string | undefined;
      let upgradeEmail: string | undefined;
      if (plan === 'upgrade') {
        const key = normalizeKey(req.query.key);
        const l = key ? licenses.byKey(key) : undefined;
        const device = String(req.query.device ?? '');
        const onDevice = l && deviceSchema.safeParse(device).success && licenses.validate(l.key, device).valid;
        if (!l || l.status !== 'active' || !onDevice) {
          return res
            .status(400)
            .type('html')
            .send(messagePage('Can’t upgrade this key', 'Open Driftsky on a computer that has the key and choose Upgrade from there.'));
        }
        if (l.seats >= 5) return res.type('html').send(messagePage('Already upgraded', 'This key already covers 5 computers.'));
        upgradeLicenseId = l.id;
        upgradeKey = l.key;
        upgradeEmail = l.email;
      }
      const c = await payments.createCheckout({
        plan,
        upgradeKey,
        upgradeEmail,
        successUrl: `${cfg.PUBLIC_URL}/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${cfg.PUBLIC_URL}/#pricing`,
      });
      orders.recordSession(c.id, plan, payments.name, upgradeLicenseId, upgradeEmail);
      res.redirect(303, c.url);
    } catch (e) {
      next(e);
    }
  });

  /** Used by the thank-you page to show the key while the email is on its way. */
  app.get('/api/checkout/session', limits.session, (req, res) => {
    const id = String(req.query.id ?? '');
    if (!/^cs_[A-Za-z0-9_]{6,200}$/.test(id)) return res.status(400).json({ error: 'bad_session' });
    const s = orders.session(id);
    if (!s) return res.status(404).json({ error: 'not_found' });
    const l = s.license_id ? licenses.byId(s.license_id) : undefined;
    if (s.status !== 'paid' || !l) return res.json({ status: s.status === 'expired' ? 'expired' : 'pending' });
    if (l.status !== 'active') return res.json({ status: 'revoked' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'paid', email: l.email, key: l.key, seats: l.seats, plan: s.plan });
  });

  // ---- mock checkout (development / tests only) ----
  if (payments.name === 'mock') {
    app.get('/dev/checkout/:id', (req, res) => {
      const s = orders.session(req.params.id);
      if (!s) return res.status(404).type('html').send(messagePage('Checkout not found', 'Start again from the pricing section.'));
      const plan = PLANS[s.plan];
      res.type('html')
        .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test checkout · Driftsky</title>
<style>body{margin:0;font-family:-apple-system,Inter,Arial,sans-serif;background:#f5f5f7;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
form{background:#fff;border-radius:16px;padding:28px;width:100%;max-width:380px;box-shadow:0 10px 40px #0001}h1{font-size:20px;margin:0 0 4px}.p{font-size:32px;font-weight:700;margin:8px 0 20px}
label{display:block;font-size:13px;color:#6e6e73;margin-bottom:6px}input[type=email]{width:100%;box-sizing:border-box;padding:12px;border:1px solid #d2d2d7;border-radius:10px;font-size:16px;margin-bottom:12px}
.row{display:flex;gap:8px;align-items:center;font-size:13px;color:#6e6e73;margin-bottom:16px}button{width:100%;padding:13px;border:0;border-radius:999px;font-size:16px;font-weight:600;cursor:pointer}
.pay{background:#1f6fe0;color:#fff;margin-bottom:8px}.ghost{background:#f5f5f7;color:#0b0b10}.note{font-size:12px;color:#86868b;margin-top:14px;text-align:center}</style></head><body>
<form method="post" action="/dev/checkout/${esc(s.id)}"><h1>${esc(plan.name)}</h1><div class="p">$${plan.cents / 100}</div>
<label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email" value="${esc(s.email ?? '')}">
<div class="row"><input id="consent" type="checkbox" name="consent" value="1"><label for="consent" style="margin:0">Send me offers from Driftsky</label></div>
<button class="pay" name="action" value="pay">Pay $${plan.cents / 100}</button>
<button class="ghost" name="action" value="expire" formnovalidate>Leave without paying</button>
<p class="note">Test mode. No card is charged.</p></form></body></html>`);
    });
    app.post('/dev/checkout/:id', async (req, res, next) => {
      try {
        const s = orders.session(req.params.id);
        if (!s) return res.status(404).type('html').send(messagePage('Checkout not found', 'Start again from the pricing section.'));
        const email = String(req.body.email ?? s.email ?? '').trim();
        if (req.body.action === 'expire') {
          await orders.expired({ sessionId: s.id, email: email || null, consent: req.body.consent === '1' });
          return res.redirect(303, '/#pricing');
        }
        if (!z.string().email().safeParse(email).success)
          return res
            .status(400)
            .type('html')
            .send(messagePage('Check your email', 'That email address doesn’t look right.', { href: `/dev/checkout/${s.id}`, label: 'Try again' }));
        await orders.fulfil({ sessionId: s.id, plan: s.plan, email, paymentIntent: 'pi_mock_' + s.id.slice(8) });
        res.redirect(303, `/thanks?session_id=${encodeURIComponent(s.id)}`);
      } catch (e) {
        next(e);
      }
    });
  }

  // ---- licenses ----
  const licenseError = (res: Response, error: LicenseError | 'not_activated' | 'bad_request', extra: object = {}) => {
    const status = { bad_key: 400, bad_device: 400, bad_request: 400, not_found: 404, revoked: 403, seats_full: 409, not_activated: 409 }[error];
    res.status(status).json({ error, message: LICENSE_MESSAGES[error], ...extra });
  };

  app.post('/api/license/activate', limits.license, (req, res) => {
    const b = activateBody.safeParse(req.body);
    if (!b.success) return licenseError(res, inputError(req.body));
    const r = licenses.activate(b.data.key, b.data.device, { name: b.data.name, platform: b.data.platform, appVersion: b.data.appVersion });
    if (!r.ok) return licenseError(res, r.error, r.license ? { license: r.license } : {});
    res.json({ ok: true, key: normalizeKey(b.data.key), already: r.already, license: r.license });
  });

  app.post('/api/license/deactivate', limits.license, (req, res) => {
    const b = keyDeviceBody.safeParse(req.body);
    if (!b.success) return licenseError(res, inputError(req.body));
    const r = licenses.deactivate(b.data.key, b.data.device);
    if (!r.ok) return licenseError(res, r.error);
    res.json({ ok: true, removed: r.removed });
  });

  app.post('/api/license/validate', limits.license, (req, res) => {
    const b = keyDeviceBody.safeParse(req.body);
    if (!b.success) return licenseError(res, inputError(req.body));
    const r = licenses.validate(b.data.key, b.data.device);
    if (!r.valid) return res.json({ valid: false, reason: r.reason, message: LICENSE_MESSAGES[r.reason!], license: r.license ?? null });
    res.json({ valid: true, license: r.license });
  });

  app.post('/api/license/resend', limits.resend, async (req, res, next) => {
    try {
      const b = z.object({ email: z.string().email().max(254) }).safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: 'bad_email', message: 'That email address doesn’t look right.' });
      // don't wait for the email: response time must not reveal whether this address bought
      void orders.resendKeys(b.data.email).catch((e) => console.error('[resend]', (e as Error).message));
      // same answer whether or not we found keys, so this can't be used to probe emails
      res.json({ ok: true, message: 'If that email bought Driftsky, the key is on its way.' });
    } catch (e) {
      next(e);
    }
  });

  if (devRoutes) {
    app.get('/dev/outbox', (req, res) => {
      const to = req.query.to ? String(req.query.to) : null;
      const rows = to
        ? db.prepare('SELECT * FROM outbox WHERE lower("to") = lower(?) ORDER BY id DESC LIMIT 50').all(to)
        : db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 50').all();
      res.json(rows);
    });
    app.post('/dev/reset-limits', (_req, res) => {
      Object.values(limits).forEach((l) => l.reset());
      res.json({ ok: true });
    });
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  return { app, licenses, orders, limits };
}

/** Serve the built site with an SPA fallback and proper 404s for missing files. */
export function serveStatic(app: express.Express, dir: string) {
  const index = path.join(dir, 'index.html');
  app.use(
    express.static(dir, {
      index: false,
      setHeaders(res, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  const spaRoutes = new Set(['/', '/terms', '/privacy', '/refunds', '/thanks', '/lost-key']);
  app.get('*', (req, res) => {
    const html = fs.readFileSync(index, 'utf8');
    res
      .status(spaRoutes.has(req.path.replace(/\/$/, '') || '/') ? 200 : 404)
      .type('html')
      .send(html);
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  // body-parser errors (malformed JSON, too large) are the client's fault
  const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  if (status && status >= 400 && status < 500) {
    const error = status === 413 ? 'too_large' : 'bad_request';
    if (req.path.startsWith('/api/')) return res.status(status).json({ error, message: 'That request couldn’t be read.' });
    return res.status(status).type('html').send(messagePage('That didn’t work', 'The request couldn’t be read.'));
  }
  console.error('[error]', req.method, req.path, err);
  if (req.path.startsWith('/api/') && req.method !== 'GET')
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong on our side. Try again in a moment.' });
  res.status(500).type('html').send(messagePage('Something went wrong', 'That didn’t work on our side. Try again in a moment.'));
}
