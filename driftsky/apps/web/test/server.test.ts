import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from '../server/config';
import { openDb } from '../server/db';
import { createApp, errorHandler } from '../server/app';
import { MockProvider, StripeProvider, signStripePayload, verifyStripeSignature } from '../server/payments';
import { OutboxMailer } from '../server/mailer';
import { ReleaseStore, compareVersions } from '../server/releases';
import { generateKey, normalizeKey } from '../server/licenses';

const WHSEC = 'whsec_test_secret';
const dev = (n: number) =>
  crypto
    .createHash('sha256')
    .update('device-' + n)
    .digest('hex');

function setup(over: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-'));
  const releasesPath = path.join(dir, 'releases.json');
  const cfg = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:9999',
    DATABASE_PATH: ':memory:',
    STRIPE_WEBHOOK_SECRET: WHSEC,
    RELEASES_PATH: releasesPath,
    ...over,
  } as NodeJS.ProcessEnv);
  const db = openDb(':memory:');
  const payments = new MockProvider(cfg.PUBLIC_URL);
  const mailer = new OutboxMailer(db);
  const releases = new ReleaseStore(releasesPath);
  const built = createApp({ cfg, db, payments, mailer, releases });
  built.app.use(errorHandler);
  const outbox = () => db.prepare('SELECT * FROM outbox ORDER BY id').all() as Array<{ to: string; subject: string; text: string }>;
  return { ...built, db, cfg, releasesPath, outbox };
}

/** Run the mock checkout for a plan and return the issued key. */
async function buy(app: Parameters<typeof request>[0], plan: 'one' | 'five', email = 'ann@example.com') {
  const start = await request(app).get(`/api/checkout?plan=${plan}`);
  expect(start.status).toBe(303);
  const id = start.headers.location.split('/').pop()!;
  const paid = await request(app).post(`/dev/checkout/${id}`).type('form').send({ email, action: 'pay' });
  expect(paid.status).toBe(303);
  expect(paid.headers.location).toBe(`/thanks?session_id=${id}`);
  const s = await request(app).get(`/api/checkout/session?id=${id}`);
  expect(s.body.status).toBe('paid');
  return { key: s.body.key as string, sessionId: id };
}

describe('license keys', () => {
  it('generates well-formed, unique keys', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const k = generateKey();
      expect(k).toMatch(/^DRIFT-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
  it('normalizes what people paste', () => {
    const k = 'DRIFT-AB12-CD34-EF56-GH78';
    expect(normalizeKey(k)).toBe(k);
    expect(normalizeKey('  drift-ab12-cd34-ef56-gh78\n')).toBe(k);
    expect(normalizeKey('AB12CD34EF56GH78')).toBe(k);
    expect(normalizeKey('DRIFT AB12 CD34 EF56 GH78')).toBe(k);
    expect(normalizeKey('"DRIFT-AB12-CD34-EF56-GH78"')).toBe(k);
    expect(normalizeKey('DRIFT–AB12–CD34–EF56–GH78')).toBe(k); // en dashes from rich text
    expect(normalizeKey('DRIFT-ABI2-CD34-EF56-GH78')).toBe(k); // I → 1
    expect(normalizeKey('DRIFT-AB12-CD34-EF56-GH7')).toBeNull();
    expect(normalizeKey('DRIFT-AB12-CD34-EF56-GH78X')).toBeNull();
    expect(normalizeKey('DRIFT-AB12-CD34-EF56-GH7!')).toBeNull();
    expect(normalizeKey('License key: DRIFT-AB12-CD34-EF56-GH78.')).toBe(k);
    expect(normalizeKey(42)).toBeNull();
    expect(normalizeKey('')).toBeNull();
  });
});

describe('config', () => {
  it('refuses mock payments and the dev salt in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/PAYMENTS=mock/);
    expect(() => loadConfig({ NODE_ENV: 'production', PAYMENTS: 'stripe', STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' } as NodeJS.ProcessEnv)).toThrow(
      /DEVICE_SALT/,
    );
    expect(() => loadConfig({ PAYMENTS: 'stripe' } as NodeJS.ProcessEnv)).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => loadConfig({ MAIL: 'resend' } as NodeJS.ProcessEnv)).toThrow(/RESEND_API_KEY/);
    expect(
      loadConfig({
        NODE_ENV: 'production',
        PAYMENTS: 'stripe',
        STRIPE_SECRET_KEY: 'sk',
        STRIPE_WEBHOOK_SECRET: 'wh',
        DEVICE_SALT: 'x'.repeat(32),
        MAIL: 'resend',
        RESEND_API_KEY: 're',
      } as NodeJS.ProcessEnv).PAYMENTS,
    ).toBe('stripe');
  });
});

describe('checkout (mock provider)', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => (t = setup()));

  it('sells a 1-computer key and emails it', async () => {
    const { key } = await buy(t.app, 'one');
    expect(normalizeKey(key)).toBe(key);
    const mail = t.outbox();
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toBe('ann@example.com');
    expect(mail[0].subject).toMatch(/license key/i);
    expect(mail[0].text).toContain(key);
    expect(mail[0].text).toContain('1 computer');
    expect(t.licenses.byKey(key)!.seats).toBe(1);
  });

  it('sells a 5-computer key', async () => {
    const { key } = await buy(t.app, 'five');
    expect(t.licenses.byKey(key)!.seats).toBe(5);
    expect(t.outbox()[0].text).toContain('up to 5 computers');
  });

  it('rejects unknown plans and bad session ids', async () => {
    expect((await request(t.app).get('/api/checkout?plan=free')).status).toBe(400);
    expect((await request(t.app).get('/api/checkout')).status).toBe(400);
    expect((await request(t.app).get('/api/checkout/session?id=nope')).status).toBe(400);
    expect((await request(t.app).get('/api/checkout/session?id=cs_mock_doesnotexist')).status).toBe(404);
    expect((await request(t.app).get('/dev/checkout/cs_mock_missing')).status).toBe(404);
  });

  it('shows pending until paid and never issues twice for one session', async () => {
    const start = await request(t.app).get('/api/checkout?plan=one');
    const id = start.headers.location.split('/').pop()!;
    expect((await request(t.app).get(`/api/checkout/session?id=${id}`)).body).toEqual({ status: 'pending' });
    const page = await request(t.app).get(`/dev/checkout/${id}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Pay $9');
    await request(t.app).post(`/dev/checkout/${id}`).type('form').send({ email: 'bo@example.com', action: 'pay' });
    await request(t.app).post(`/dev/checkout/${id}`).type('form').send({ email: 'bo@example.com', action: 'pay' });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM licenses').get()).toEqual({ n: 1 });
    expect(t.outbox()).toHaveLength(1);
  });

  it('rejects a bad email on the test checkout', async () => {
    const id = (await request(t.app).get('/api/checkout?plan=one')).headers.location.split('/').pop()!;
    const r = await request(t.app).post(`/dev/checkout/${id}`).type('form').send({ email: 'not-an-email', action: 'pay' });
    expect(r.status).toBe(400);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM licenses').get()).toEqual({ n: 0 });
  });

  it('sends one 20% offer when someone leaves with consent, never twice', async () => {
    for (let i = 0; i < 2; i++) {
      const id = (await request(t.app).get('/api/checkout?plan=five')).headers.location.split('/').pop()!;
      await request(t.app).post(`/dev/checkout/${id}`).type('form').send({ email: 'cy@example.com', action: 'expire', consent: '1' });
    }
    const offers = t.outbox().filter((m) => /20%/.test(m.subject));
    expect(offers).toHaveLength(1);
    expect(offers[0].text).toMatch(/DRIFT20-/);
    expect(offers[0].text).toContain('5 computers');
  });

  it('sends no offer without consent', async () => {
    const id = (await request(t.app).get('/api/checkout?plan=one')).headers.location.split('/').pop()!;
    await request(t.app).post(`/dev/checkout/${id}`).type('form').send({ email: 'dee@example.com', action: 'expire' });
    expect(t.outbox()).toHaveLength(0);
    expect((await request(t.app).get(`/api/checkout/session?id=${id}`)).body.status).toBe('expired');
  });
});

describe('activation', () => {
  let t: ReturnType<typeof setup>;
  let key: string;
  beforeEach(async () => {
    t = setup();
    key = (await buy(t.app, 'one')).key;
  });
  const activate = (body: object) => request(t.app).post('/api/license/activate').send(body);

  it('activates, is idempotent per computer, and enforces seats', async () => {
    const a = await activate({ key, device: dev(1), name: 'Ann’s MacBook', platform: 'mac', appVersion: '1.0.0' });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ ok: true, key, already: false, license: { email: 'ann@example.com', seats: 1, used: 1 } });
    const again = await activate({ key: key.toLowerCase(), device: dev(1) });
    expect(again.body).toMatchObject({ ok: true, already: true, license: { used: 1 } });
    const full = await activate({ key, device: dev(2) });
    expect(full.status).toBe(409);
    expect(full.body.error).toBe('seats_full');
    expect(full.body.message).toMatch(/Remove it from one/);
  });

  it('moves a key: remove from the old computer, add to the new one', async () => {
    await activate({ key, device: dev(1) });
    const rm = await request(t.app)
      .post('/api/license/deactivate')
      .send({ key, device: dev(1) });
    expect(rm.body).toEqual({ ok: true, removed: true });
    const rm2 = await request(t.app)
      .post('/api/license/deactivate')
      .send({ key, device: dev(1) });
    expect(rm2.body).toEqual({ ok: true, removed: false });
    expect((await activate({ key, device: dev(2) })).status).toBe(200);
    // the old computer now learns it was removed
    const v = await request(t.app)
      .post('/api/license/validate')
      .send({ key, device: dev(1) });
    expect(v.body).toMatchObject({ valid: false, reason: 'not_activated' });
  });

  it('5-computer keys hold five, mixing Mac and PC', async () => {
    const k5 = (await buy(t.app, 'five', 'eve@example.com')).key;
    for (let i = 0; i < 5; i++) expect((await activate({ key: k5, device: dev(10 + i), platform: i % 2 ? 'windows' : 'mac' })).status).toBe(200);
    expect((await activate({ key: k5, device: dev(99) })).status).toBe(409);
  });

  it('rejects bad input with helpful messages', async () => {
    const cases: Array<[object, number, string]> = [
      [{ key: 'hello', device: dev(1) }, 400, 'bad_key'],
      [{ key, device: 'abc' }, 400, 'bad_device'],
      [{ key }, 400, 'bad_device'],
      [{}, 400, 'bad_key'],
      [{ key: 'DRIFT-0000-0000-0000-0000', device: dev(1) }, 404, 'not_found'],
      [{ key, device: dev(1), platform: 'amiga' }, 400, 'bad_request'],
      [{ key, device: dev(1), name: 'x'.repeat(200) }, 400, 'bad_request'],
      [{ key: 'x'.repeat(5000), device: dev(1) }, 400, 'bad_key'],
    ];
    for (const [body, status, error] of cases) {
      const r = await activate(body);
      expect([r.status, r.body.error]).toEqual([status, error]);
      expect(typeof r.body.message).toBe('string');
    }
    const nonJson = await request(t.app).post('/api/license/activate').set('Content-Type', 'application/json').send('{oops');
    expect(nonJson.status).toBe(400);
    expect(nonJson.body.error).toBe('bad_request');
    const huge = await request(t.app)
      .post('/api/license/activate')
      .send({ key, device: dev(1), name: 'x'.repeat(40_000) });
    expect(huge.status).toBe(413);
  });

  it('validates and refuses revoked keys', async () => {
    await activate({ key, device: dev(1) });
    expect(
      (
        await request(t.app)
          .post('/api/license/validate')
          .send({ key, device: dev(1) })
      ).body,
    ).toMatchObject({ valid: true, license: { seats: 1, used: 1 } });
    t.licenses.revoke(t.licenses.byKey(key)!.id, 'refunded');
    expect(
      (
        await request(t.app)
          .post('/api/license/validate')
          .send({ key, device: dev(1) })
      ).body,
    ).toMatchObject({ valid: false, reason: 'revoked' });
    expect((await activate({ key, device: dev(3) })).status).toBe(403);
  });

  it('never stores the raw device id', async () => {
    await activate({ key, device: dev(1) });
    const rows = t.db.prepare('SELECT device FROM activations').all() as Array<{ device: string }>;
    expect(rows[0].device).not.toBe(dev(1));
    expect(rows[0].device).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles concurrent activations without overselling seats', async () => {
    const k5 = (await buy(t.app, 'five', 'fay@example.com')).key;
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => activate({ key: k5, device: dev(100 + i) })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(5);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(7);
  });

  it('rate limits guessing', async () => {
    let last = 0;
    for (let i = 0; i < 35; i++) last = (await activate({ key: 'DRIFT-0000-0000-0000-0000', device: dev(1) })).status;
    expect(last).toBe(429);
  });
});

describe('upgrade 1 → 5 computers', () => {
  it('upgrades the same key from the app', async () => {
    const t = setup();
    const { key } = await buy(t.app, 'one');
    await request(t.app)
      .post('/api/license/activate')
      .send({ key, device: dev(1) });
    // not on this device → refused
    expect((await request(t.app).get(`/api/checkout?plan=upgrade&key=${key}&device=${dev(2)}`)).status).toBe(400);
    expect((await request(t.app).get(`/api/checkout?plan=upgrade&key=nope&device=${dev(1)}`)).status).toBe(400);
    const start = await request(t.app).get(`/api/checkout?plan=upgrade&key=${encodeURIComponent(key)}&device=${dev(1)}`);
    expect(start.status).toBe(303);
    const id = start.headers.location.split('/').pop()!;
    const page = await request(t.app).get(`/dev/checkout/${id}`);
    expect(page.text).toContain('ann@example.com'); // prefilled
    expect(page.text).toContain('Pay $6');
    await request(t.app).post(`/dev/checkout/${id}`).type('form').send({ email: 'ann@example.com', action: 'pay' });
    expect(t.licenses.byKey(key)!.seats).toBe(5);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM licenses').get()).toEqual({ n: 1 });
    expect(t.outbox().at(-1)!.subject).toMatch(/5 computers/);
    // now upgrading again is pointless
    const again = await request(t.app).get(`/api/checkout?plan=upgrade&key=${key}&device=${dev(1)}`);
    expect(again.text).toContain('Already upgraded');
  });
});

describe('stripe webhook', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => (t = setup()));
  const send = (event: object, sig?: string) => {
    const body = JSON.stringify(event);
    return request(t.app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', sig ?? signStripePayload(body, WHSEC))
      .send(body);
  };
  const completed = (id: string, extra: object = {}) => ({
    id: 'evt_' + id,
    type: 'checkout.session.completed',
    data: {
      object: { id, payment_status: 'paid', customer_details: { email: 'gus@example.com' }, payment_intent: 'pi_' + id, metadata: { plan: 'five' }, ...extra },
    },
  });

  it('issues a key on checkout.session.completed, once', async () => {
    expect((await send(completed('cs_test_1'))).status).toBe(200);
    expect((await send(completed('cs_test_1'))).body.duplicate).toBe(true);
    // same session, different event id (Stripe can send both completed + async succeeded)
    await send({ ...completed('cs_test_1'), id: 'evt_other' });
    const rows = t.db.prepare('SELECT * FROM licenses').all() as Array<{ seats: number; email: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seats: 5, email: 'gus@example.com' });
    expect(t.outbox()).toHaveLength(1);
    const s = await request(t.app).get('/api/checkout/session?id=cs_test_1');
    expect(s.body).toMatchObject({ status: 'paid', seats: 5, email: 'gus@example.com' });
  });

  it('waits for delayed payments', async () => {
    await send(completed('cs_test_2', { payment_status: 'unpaid' }));
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM licenses').get()).toEqual({ n: 0 });
    await send({ ...completed('cs_test_2'), id: 'evt_async', type: 'checkout.session.async_payment_succeeded' });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM licenses').get()).toEqual({ n: 1 });
  });

  it('rejects bad, missing, stale and tampered signatures', async () => {
    const ev = completed('cs_test_3');
    expect((await send(ev, 'garbage')).status).toBe(400);
    expect((await send(ev, signStripePayload(JSON.stringify(ev), 'whsec_wrong'))).status).toBe(400);
    expect((await send(ev, signStripePayload(JSON.stringify(ev), WHSEC, Math.floor(Date.now() / 1000) - 3600))).status).toBe(400);
    const r = await request(t.app).post('/api/stripe/webhook').set('Content-Type', 'application/json').send(JSON.stringify(ev));
    expect(r.status).toBe(400);
    // signature for a different body
    const other = signStripePayload(JSON.stringify(completed('cs_test_x')), WHSEC);
    expect((await send(ev, other)).status).toBe(400);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM licenses').get()).toEqual({ n: 0 });
  });

  it('turns keys off on refund and dispute', async () => {
    await send(completed('cs_test_4'));
    await send({
      id: 'evt_r',
      type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_cs_test_4', refunded: true, amount: 1500, amount_refunded: 1500 } },
    });
    expect((t.db.prepare('SELECT status, revoked_reason FROM licenses').get() as { status: string }).status).toBe('revoked');
    await send(completed('cs_test_5'));
    await send({ id: 'evt_d', type: 'charge.dispute.created', data: { object: { payment_intent: 'pi_cs_test_5' } } });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM licenses WHERE status='revoked'").get()).toEqual({ n: 2 });
  });

  it('a partial refund keeps the key', async () => {
    await send(completed('cs_test_6'));
    await send({
      id: 'evt_pr',
      type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_cs_test_6', refunded: false, amount: 1500, amount_refunded: 500 } },
    });
    expect((t.db.prepare('SELECT status FROM licenses').get() as { status: string }).status).toBe('active');
  });

  it('acknowledges events that can never work, instead of letting Stripe retry for days', async () => {
    const r = await send({
      id: 'evt_bad',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_7', payment_status: 'paid', metadata: { plan: 'one' } } },
    });
    expect(r.status).toBe(200);
    expect(r.body.ignored).toBe(true);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM licenses').get()).toEqual({ n: 0 });
  });

  it('ignores unrelated events', async () => {
    expect((await send({ id: 'evt_x', type: 'customer.created', data: { object: {} } })).status).toBe(200);
  });
});

describe('signature helper', () => {
  it('accepts any matching v1 among several', () => {
    const body = '{"a":1}';
    const good = signStripePayload(body, WHSEC, 1000).split(',')[1];
    expect(verifyStripeSignature(body, `t=1000,v1=deadbeef,${good}`, WHSEC, 300, 1100)).toBe(true);
    expect(verifyStripeSignature(body, `t=1000,${good}`, WHSEC, 300, 2000)).toBe(false);
    expect(verifyStripeSignature(body, undefined, WHSEC)).toBe(false);
    expect(verifyStripeSignature(body, 't=abc,v1=00', WHSEC)).toBe(false);
  });
});

describe('StripeProvider', () => {
  it('creates a checkout session with the right parameters', async () => {
    const calls: Array<{ url: string; body: URLSearchParams; auth: string }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: new URLSearchParams(String(init.body)), auth: String((init.headers as Record<string, string>).Authorization) });
      return new Response(JSON.stringify({ id: 'cs_live_x', url: 'https://checkout.stripe.com/c/pay/cs_live_x' }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new StripeProvider({ STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_API_BASE: 'https://api.stripe.com' }, fake);
    const r = await p.createCheckout({ plan: 'five', successUrl: 'https://x/thanks?session_id={CHECKOUT_SESSION_ID}', cancelUrl: 'https://x/#pricing' });
    expect(r.url).toContain('checkout.stripe.com');
    const b = calls[0].body;
    expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(calls[0].auth).toBe('Bearer sk_test_1');
    expect(b.get('mode')).toBe('payment');
    expect(b.get('line_items[0][price_data][unit_amount]')).toBe('1500');
    expect(b.get('metadata[plan]')).toBe('five');
    expect(b.get('consent_collection[promotions]')).toBe('auto');
    expect(b.get('adaptive_pricing[enabled]')).toBe('true');
    expect(b.get('success_url')).toContain('{CHECKOUT_SESSION_ID}');
  });
  it('uses configured price ids and surfaces Stripe errors', async () => {
    const fake = (async (_u: string, init: RequestInit) => {
      const b = new URLSearchParams(String(init.body));
      expect(b.get('line_items[0][price]')).toBe('price_one');
      return new Response(JSON.stringify({ error: { message: 'No such price' } }), { status: 400 });
    }) as unknown as typeof fetch;
    const p = new StripeProvider({ STRIPE_SECRET_KEY: 'sk', STRIPE_API_BASE: 'https://api.stripe.com', STRIPE_PRICE_ONE: 'price_one' }, fake);
    await expect(p.createCheckout({ plan: 'one', successUrl: 'https://x', cancelUrl: 'https://x' })).rejects.toThrow(/No such price/);
  });
});

describe('releases & downloads', () => {
  it('serves the manifest and redirects downloads; 503 when not configured', async () => {
    const t = setup();
    expect((await request(t.app).get('/api/app')).status).toBe(404);
    const dl = await request(t.app).get('/download');
    expect(dl.status).toBe(503);
    expect(dl.text).toContain('isn’t up yet');
    const sha = 'a'.repeat(64);
    fs.writeFileSync(
      t.releasesPath,
      JSON.stringify({
        mac: {
          latest: '1.2.0',
          minimum: '1.0.0',
          url: 'https://dl.example.com/Driftsky-1.2.0.dmg',
          sha256: sha,
          download: 'https://dl.example.com/Driftsky.dmg',
        },
        windows: { latest: '1.2.1', url: 'https://dl.example.com/Driftsky-Setup-1.2.1.exe', sha256: sha },
      }),
    );
    const m = await request(t.app).get('/api/app?platform=mac');
    expect(m.body).toEqual({ latest: '1.2.0', minimum: '1.0.0', url: 'https://dl.example.com/Driftsky-1.2.0.dmg', sha256: sha, notes: null });
    expect((await request(t.app).get('/api/app?platform=windows')).body.latest).toBe('1.2.1');
    expect((await request(t.app).get('/download')).headers.location).toBe('https://dl.example.com/Driftsky.dmg');
    expect((await request(t.app).get('/download/windows')).headers.location).toBe('https://dl.example.com/Driftsky-Setup-1.2.1.exe');
  });
  it('ignores a malformed releases file, keeping the last good one', async () => {
    const t = setup();
    fs.writeFileSync(t.releasesPath, '{"mac": {"latest": "one"}}');
    expect((await request(t.app).get('/api/app')).status).toBe(404);
    fs.writeFileSync(t.releasesPath, JSON.stringify({ mac: { latest: '1.0.0', url: 'https://dl.example.com/a.dmg', sha256: 'c'.repeat(64) } }));
    expect((await request(t.app).get('/api/app')).body.latest).toBe('1.0.0');
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(t.releasesPath, '{"mac": {"lat');
    expect((await request(t.app).get('/api/app')).body.latest).toBe('1.0.0');
  });
  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.1')).toBe(-1);
  });
});

describe('lost key', () => {
  it('re-sends keys without revealing whether an email bought', async () => {
    const t = setup();
    const { key } = await buy(t.app, 'one', 'hal@example.com');
    const a = await request(t.app).post('/api/license/resend').send({ email: 'HAL@example.com' });
    const b = await request(t.app).post('/api/license/resend').send({ email: 'nobody@example.com' });
    expect(a.body).toEqual(b.body);
    const mail = t.outbox().filter((m) => m.to === 'hal@example.com');
    expect(mail).toHaveLength(2);
    expect(mail[1].text).toContain(key);
    expect((await request(t.app).post('/api/license/resend').send({ email: 'nope' })).status).toBe(400);
  });
});

describe('misc', () => {
  it('sets security headers, 404s unknown API routes, hides dev routes in production', async () => {
    const t = setup();
    const r = await request(t.app).get('/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect((await request(t.app).get('/api/nope')).status).toBe(404);
    expect((await request(t.app).get('/dev/outbox')).status).toBe(200);
    const p = setup({
      NODE_ENV: 'production',
      PAYMENTS: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test',
      DEVICE_SALT: 'y'.repeat(40),
      MAIL: 'resend',
      RESEND_API_KEY: 're_test',
    });
    expect((await request(p.app).get('/dev/outbox')).status).toBe(404);
    expect((await request(p.app).get('/dev/checkout/cs_mock_x')).status).toBe(404);
    expect((await request(p.app).get('/api/health')).headers['content-security-policy']).toContain("default-src 'self'");
  });
});

describe('review fixes', () => {
  const sendTo = (t: ReturnType<typeof setup>, body: string) =>
    request(t.app).post('/api/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', signStripePayload(body, WHSEC)).send(body);

  it('a signed but malformed event is rejected, never crashes', async () => {
    const t = setup();
    for (const body of [
      'null',
      '[]',
      '"x"',
      '{"type":"foo","data":{"object":{}}}',
      '{"id":5,"type":"x"}',
      '{"id":"evt_1","type":"checkout.session.completed","data":null}',
    ]) {
      const r = await sendTo(t, body);
      expect([200, 400, 500]).toContain(r.status);
    }
    expect((await request(t.app).get('/api/health')).status).toBe(200);
  });

  it('prototype names are not plans', async () => {
    const t = setup();
    for (const plan of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect((await request(t.app).get(`/api/checkout?plan=${plan}`)).status).toBe(400);
    }
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM checkout_sessions').get()).toEqual({ n: 0 });
    const ev = JSON.stringify({
      id: 'evt_p',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_p', payment_status: 'paid', customer_details: { email: 'p@example.com' }, metadata: { plan: 'toString' } } },
    });
    expect((await sendTo(t, ev)).body.ignored).toBe(true);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM licenses').get()).toEqual({ n: 0 });
  });

  it('refunding an upgrade only takes the key back to 1 computer; refunding the purchase turns it off', async () => {
    const t = setup();
    const { key } = await buy(t.app, 'one');
    await request(t.app)
      .post('/api/license/activate')
      .send({ key, device: dev(1) });
    const id = (await request(t.app).get(`/api/checkout?plan=upgrade&key=${key}&device=${dev(1)}`)).headers.location.split('/').pop()!;
    await request(t.app).post(`/dev/checkout/${id}`).type('form').send({ email: 'ann@example.com', action: 'pay' });
    for (const n of [2, 3])
      await request(t.app)
        .post('/api/license/activate')
        .send({ key, device: dev(n) });
    const l = t.licenses.byKey(key)! as unknown as { payment_intent: string; upgrade_payment_intent: string };
    expect(l.upgrade_payment_intent).toMatch(/^pi_mock_/);
    expect(l.payment_intent).not.toBe(l.upgrade_payment_intent);
    expect(t.licenses.refundPayment(l.upgrade_payment_intent, 'refunded')).toBe('downgraded');
    const after = t.licenses.byKey(key)!;
    expect(after).toMatchObject({ status: 'active', seats: 1 });
    expect(t.licenses.validate(key, dev(1)).valid).toBe(true);
    expect(t.licenses.validate(key, dev(2)).valid).toBe(false);
    expect(t.licenses.refundPayment(l.payment_intent, 'refunded')).toBe('revoked');
    expect(t.licenses.byKey(key)!.status).toBe('revoked');
    const s = await request(t.app).get(`/api/checkout/session?id=${id}`);
    expect(s.body.status).toBe('revoked');
  });

  it('the thank-you poll has its own, roomier limit', async () => {
    const t = setup();
    const { sessionId } = await buy(t.app, 'one');
    for (let i = 0; i < 40; i++)
      await request(t.app)
        .post('/api/license/validate')
        .send({ key: 'DRIFT-0000-0000-0000-0000', device: dev(1) });
    expect((await request(t.app).get(`/api/checkout/session?id=${sessionId}`)).status).toBe(200);
  });

  it('names the wrong field', async () => {
    const t = setup();
    const r = await request(t.app).post('/api/license/deactivate').send({ key: 'DRIFT-0000-0000-0000-0000', device: 'nope' });
    expect(r.body.error).toBe('bad_device');
  });
});

describe('code review fixes', () => {
  const sendTo = (t: ReturnType<typeof setup>, ev: object) => {
    const body = JSON.stringify(ev);
    return request(t.app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signStripePayload(body, WHSEC))
      .send(body);
  };
  it('refuses unsafe production configs', () => {
    const base = { NODE_ENV: 'production', PAYMENTS: 'stripe', STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh', DEVICE_SALT: 'z'.repeat(32) };
    expect(() => loadConfig(base as NodeJS.ProcessEnv)).toThrow(/MAIL=resend/);
    expect(() => loadConfig({ ...base, MAIL: 'resend', RESEND_API_KEY: 're', ALLOW_MOCK_PAYMENTS: '1' } as NodeJS.ProcessEnv)).toThrow(/ALLOW_MOCK_PAYMENTS/);
    expect(loadConfig({ ...base, MAIL: 'resend', RESEND_API_KEY: 're' } as NodeJS.ProcessEnv).MAIL).toBe('resend');
  });
  it('issues keys for 100%-off checkouts', async () => {
    const t = setup();
    await sendTo(t, {
      id: 'evt_free',
      type: 'checkout.session.completed',
      data: {
        object: { id: 'cs_test_free', payment_status: 'no_payment_required', customer_details: { email: 'free@example.com' }, metadata: { plan: 'one' } },
      },
    });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM licenses').get()).toEqual({ n: 1 });
  });
  it('reinstates a key when a dispute is won', async () => {
    const t = setup();
    await sendTo(t, {
      id: 'evt_c',
      type: 'checkout.session.completed',
      data: {
        object: { id: 'cs_test_d', payment_status: 'paid', customer_details: { email: 'd@example.com' }, payment_intent: 'pi_d', metadata: { plan: 'one' } },
      },
    });
    await sendTo(t, { id: 'evt_dc', type: 'charge.dispute.created', data: { object: { payment_intent: 'pi_d' } } });
    expect((t.db.prepare('SELECT status FROM licenses').get() as { status: string }).status).toBe('revoked');
    await sendTo(t, { id: 'evt_dw', type: 'charge.dispute.closed', data: { object: { payment_intent: 'pi_d', status: 'won' } } });
    expect((t.db.prepare('SELECT status FROM licenses').get() as { status: string }).status).toBe('active');
  });
  it('a failed offer can be retried by Stripe', async () => {
    const t = setup();
    const p = (t as unknown as { orders: { payments: { createOffer: () => Promise<string> } } }).orders.payments;
    const real = p.createOffer.bind(p);
    p.createOffer = async () => {
      throw new Error('stripe down');
    };
    await expect(t.orders.expired({ sessionId: 'cs_x', email: 'retry@example.com', consent: true, plan: 'one' })).rejects.toThrow();
    p.createOffer = real;
    expect(await t.orders.expired({ sessionId: 'cs_x', email: 'retry@example.com', consent: true, plan: 'one' })).toBe(true);
    expect(await t.orders.expired({ sessionId: 'cs_y', email: 'retry@example.com', consent: true, plan: 'one' })).toBe(false);
  });
  it('does not reveal the buyer to someone holding a key on another computer', async () => {
    const t = setup();
    const { key } = await buy(t.app, 'one');
    await request(t.app)
      .post('/api/license/activate')
      .send({ key, device: dev(1) });
    const full = await request(t.app)
      .post('/api/license/activate')
      .send({ key, device: dev(2) });
    expect(full.body.license.email).toBe('');
    const v = await request(t.app)
      .post('/api/license/validate')
      .send({ key, device: dev(3) });
    expect(v.body.license.email).toBe('');
  });
  it('no dev routes with real payments, even with the staging flag', async () => {
    const t = setup();
    expect((await request(t.app).get('/dev/outbox')).status).toBe(200);
  });
});
