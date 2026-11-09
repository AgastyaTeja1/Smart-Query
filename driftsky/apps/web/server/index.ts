import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadConfig } from './config';
import { openDb } from './db';
import { createApp, errorHandler, serveStatic } from './app';
import { MockProvider, StripeProvider } from './payments';
import { OutboxMailer, ResendMailer } from './mailer';
import { ReleaseStore } from './releases';

const here = path.dirname(fileURLToPath(import.meta.url));

// one bad request must never take every customer's checkout down with it
process.on('unhandledRejection', (e) => console.error('[unhandled rejection]', e));

async function main() {
  const cfg = loadConfig();
  const db = openDb(cfg.DATABASE_PATH);
  const payments = cfg.PAYMENTS === 'stripe' ? new StripeProvider(cfg) : new MockProvider(cfg.PUBLIC_URL);
  const mailer = cfg.MAIL === 'resend' ? new ResendMailer(cfg.RESEND_API_KEY!, cfg.MAIL_FROM) : new OutboxMailer(db);
  const releases = new ReleaseStore(cfg.RELEASES_PATH);
  const { app } = createApp({ cfg, db, payments, mailer, releases });

  if (cfg.NODE_ENV === 'production') {
    serveStatic(app, path.join(here, 'client'));
  } else {
    const { createServer } = await import('vite');
    const root = path.resolve(here, '..');
    const vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
    app.use(express.static(path.join(root, 'public')));
  }
  app.use(errorHandler);

  if (cfg.NODE_ENV === 'production' && cfg.ALLOW_MOCK_PAYMENTS)
    console.warn('[warning] ALLOW_MOCK_PAYMENTS is on: test checkout and /dev/outbox (every email, including keys) are public. Use only for staging.');
  const server = app.listen(cfg.PORT, cfg.HOST, () => {
    console.log(`Driftsky web on ${cfg.PUBLIC_URL} (port ${cfg.PORT}, payments=${payments.name}, mail=${cfg.MAIL}, env=${cfg.NODE_ENV})`);
  });
  const stop = () => server.close(() => (db.close(), process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
