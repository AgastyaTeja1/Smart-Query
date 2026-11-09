import type { RequestHandler } from 'express';

/** IPv6 clients get a whole /64 each, so rotating addresses inside it doesn't reset the limit. */
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return v4[1];
  if (!ip.includes(':')) return ip;
  // expand :: then keep the first four groups
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return (
    groups
      .slice(0, 4)
      .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''))
      .join(':') + '::/64'
  );
}

/** Fixed-window, in-memory rate limiter keyed by client. Enough for a single instance. */
export function rateLimit(opts: { windowMs: number; max: number; name: string }): RequestHandler & { reset(): void } {
  let hits = new Map<string, { n: number; reset: number }>();
  // sweep expired windows in the background instead of on every request
  const sweep = setInterval(
    () => {
      const now = Date.now();
      for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    },
    Math.max(10_000, opts.windowMs),
  );
  sweep.unref();
  const mw: RequestHandler = (req, res, next) => {
    const now = Date.now();
    const key = clientKey(req.ip);
    let h = hits.get(key);
    if (!h || h.reset <= now) {
      h = { n: 0, reset: now + opts.windowMs };
      hits.set(key, h);
    }
    h.n++;
    res.setHeader('RateLimit-Remaining', String(Math.max(0, opts.max - h.n)));
    if (h.n > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      res.status(429).json({ error: 'rate_limited', message: 'Too many tries. Wait a minute and try again.' });
      return;
    }
    next();
  };
  return Object.assign(mw, {
    reset() {
      hits = new Map();
    },
  });
}
