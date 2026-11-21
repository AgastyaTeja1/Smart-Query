import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5173),
  HOST: z.string().default('0.0.0.0'),
  /** Public origin, used for Stripe redirect URLs and emails. */
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_PATH: z.string().default('./data/driftsky.db'),
  /** Secret used to scramble device IDs before they are stored. */
  DEVICE_SALT: z.string().min(16).default('dev-only-device-salt-change-me'),

  PAYMENTS: z.enum(['stripe', 'mock']).default('mock'),
  ALLOW_MOCK_PAYMENTS: bool,
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_API_BASE: z.string().url().default('https://api.stripe.com'),
  /** Optional pre-created Stripe Price IDs; otherwise prices are sent inline. */
  STRIPE_PRICE_ONE: z.string().optional(),
  STRIPE_PRICE_FIVE: z.string().optional(),
  STRIPE_PRICE_UPGRADE: z.string().optional(),

  MAIL: z.enum(['resend', 'outbox']).default('outbox'),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Driftsky <keys@driftsky.app>'),
  SUPPORT_EMAIL: z.string().email().default('support@driftsky.app'),

  /** JSON file describing the latest desktop releases (see releases.example.json). */
  RELEASES_PATH: z.string().default('./data/releases.json'),
  /** Directory of downloadable files served at /files (optional, for self-hosting builds). */
  FILES_DIR: z.string().optional(),

  POSTHOG_KEY: z.string().optional(),
  /** Offer the Windows download in emails (the website reads VITE_WINDOWS at build time). */
  WINDOWS_ENABLED: bool,
  TRUST_PROXY: bool,
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production') {
    if (c.PAYMENTS === 'mock' && !c.ALLOW_MOCK_PAYMENTS) throw new Error('PAYMENTS=mock is not allowed in production (set PAYMENTS=stripe)');
    if (c.DEVICE_SALT.startsWith('dev-only')) throw new Error('Set DEVICE_SALT to a long random string in production');
  }
  if (c.PAYMENTS === 'stripe' && (!c.STRIPE_SECRET_KEY || !c.STRIPE_WEBHOOK_SECRET)) {
    throw new Error('PAYMENTS=stripe needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET');
  }
  if (c.MAIL === 'resend' && !c.RESEND_API_KEY) throw new Error('MAIL=resend needs RESEND_API_KEY');
  if (c.PAYMENTS === 'stripe' && c.ALLOW_MOCK_PAYMENTS) throw new Error('ALLOW_MOCK_PAYMENTS only applies to PAYMENTS=mock; remove it with real payments');
  if (c.NODE_ENV === 'production' && c.PAYMENTS === 'stripe' && c.MAIL !== 'resend')
    throw new Error('With real payments, set MAIL=resend so customers receive their keys');
  return c;
}

export const PLANS = {
  one: { seats: 1, cents: 900, name: 'Driftsky — 1 computer', label: '1 computer' },
  five: { seats: 5, cents: 1500, name: 'Driftsky — 5 computers', label: '5 computers' },
  upgrade: { seats: 5, cents: 600, name: 'Driftsky — upgrade to 5 computers', label: 'Upgrade to 5 computers' },
} as const;
export type PlanId = keyof typeof PLANS;
