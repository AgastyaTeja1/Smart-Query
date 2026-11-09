import crypto from 'node:crypto';
import { PLANS, type Config, type PlanId } from './config';

export interface CheckoutRequest {
  plan: PlanId;
  /** Internal session id we created in our DB (mock) or metadata to round-trip. */
  upgradeKey?: string;
  upgradeEmail?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  id: string;
  url: string;
}

export interface PaymentProvider {
  readonly name: 'stripe' | 'mock';
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Create a one-time 20%-off promotion code that expires in 48 hours. */
  createOffer(email: string): Promise<string | null>;
}

/** Stripe over plain HTTPS: no SDK dependency, easy to point at a fake in tests. */
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  constructor(
    private cfg: Pick<Config, 'STRIPE_SECRET_KEY' | 'STRIPE_API_BASE' | 'STRIPE_PRICE_ONE' | 'STRIPE_PRICE_FIVE' | 'STRIPE_PRICE_UPGRADE'>,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: 'POST' | 'GET', path: string, params?: Record<string, string>): Promise<T> {
    const body = params ? new URLSearchParams(params).toString() : undefined;
    const res = await this.fetchImpl(`${this.cfg.STRIPE_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.cfg.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2024-06-20',
      },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe ${path} failed (${res.status}): ${json.error?.message ?? 'unknown error'}`);
    return json;
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const plan = PLANS[req.plan];
    const price = { one: this.cfg.STRIPE_PRICE_ONE, five: this.cfg.STRIPE_PRICE_FIVE, upgrade: this.cfg.STRIPE_PRICE_UPGRADE }[req.plan];
    const p: Record<string, string> = {
      mode: 'payment',
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      'line_items[0][quantity]': '1',
      'metadata[plan]': req.plan,
      'payment_intent_data[metadata][plan]': req.plan,
      allow_promotion_codes: 'true',
      // local currency / price by country, decided by Stripe
      'adaptive_pricing[enabled]': 'true',
      // ask for consent to send the one-time abandoned-checkout offer
      'consent_collection[promotions]': 'auto',
      'after_expiration[recovery][enabled]': 'true',
      'after_expiration[recovery][allow_promotion_codes]': 'true',
    };
    if (price) p['line_items[0][price]'] = price;
    else {
      p['line_items[0][price_data][currency]'] = 'usd';
      p['line_items[0][price_data][unit_amount]'] = String(plan.cents);
      p['line_items[0][price_data][product_data][name]'] = plan.name;
    }
    if (req.upgradeKey) p['metadata[upgrade_key]'] = req.upgradeKey;
    if (req.upgradeEmail) p.customer_email = req.upgradeEmail;
    const s = await this.call<{ id: string; url: string }>('POST', '/v1/checkout/sessions', p);
    return { id: s.id, url: s.url };
  }

  async createOffer(email: string): Promise<string | null> {
    const coupon = await this.call<{ id: string }>('POST', '/v1/coupons', {
      percent_off: '20',
      duration: 'once',
      max_redemptions: '1',
      name: '20% off Driftsky',
      'metadata[email]': email,
    });
    const code = await this.call<{ code: string }>('POST', '/v1/promotion_codes', {
      coupon: coupon.id,
      max_redemptions: '1',
      expires_at: String(Math.floor(Date.now() / 1000) + 48 * 3600),
    });
    return code.code;
  }
}

/** Local/dev provider: a fake checkout page on our own server. */
export class MockProvider implements PaymentProvider {
  readonly name = 'mock' as const;
  constructor(private publicUrl: string) {}
  async createCheckout(): Promise<CheckoutResult> {
    const id = 'cs_mock_' + crypto.randomBytes(12).toString('hex');
    return { id, url: `${this.publicUrl}/dev/checkout/${id}` };
  }
  async createOffer(): Promise<string> {
    return 'DRIFT20-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  }
}

/**
 * Verify a `Stripe-Signature` header: `t=<unix>,v1=<hex hmac>[,v1=…]`, HMAC-SHA256 of
 * `${t}.${rawBody}` with the endpoint secret, and a 5-minute timestamp tolerance.
 */
export function verifyStripeSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')}`)
    .digest();
  return sigs.some((s) => {
    if (!s || !/^[a-f0-9]+$/i.test(s)) return false;
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

/** Build a valid signature header (used by tests and the local webhook replayer). */
export function signStripePayload(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${sig}`;
}
