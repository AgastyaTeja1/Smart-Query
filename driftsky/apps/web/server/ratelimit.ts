import type { RequestHandler } from 'express';

/** Fixed-window, in-memory rate limiter keyed by client IP. Enough for a single instance. */
export function rateLimit(opts: { windowMs: number; max: number; name: string }): RequestHandler & { reset(): void } {
  let hits = new Map<string, { n: number; reset: number }>();
  const mw: RequestHandler = (req, res, next) => {
    const now = Date.now();
    const ip = req.ip ?? 'unknown';
    let h = hits.get(ip);
    if (!h || h.reset <= now) {
      h = { n: 0, reset: now + opts.windowMs };
      hits.set(ip, h);
    }
    h.n++;
    if (hits.size > 50_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
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
