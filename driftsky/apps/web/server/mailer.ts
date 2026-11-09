import type { DB } from './db';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(m: Mail): Promise<void>;
}

/** Stores mail in the database; readable at /dev/outbox outside production. */
export class OutboxMailer implements Mailer {
  constructor(private db: DB) {}
  async send(m: Mail) {
    this.db.prepare('INSERT INTO outbox ("to", subject, text, html) VALUES (?, ?, ?, ?)').run(m.to, m.subject, m.text, m.html);
  }
}

export class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async send(m: Mail) {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
    });
    if (!res.ok) throw new Error(`Resend failed (${res.status}): ${await res.text().catch(() => '')}`);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#0b0b10">
<div style="max-width:520px;margin:0 auto;padding:40px 24px">
<div style="font-weight:600;font-size:17px;margin-bottom:24px">Driftsky</div>
<div style="background:#fff;border-radius:16px;padding:28px">
<h1 style="font-size:22px;margin:0 0 12px;letter-spacing:-0.4px">${esc(title)}</h1>
${body}
</div>
<p style="color:#6e6e73;font-size:12px;margin-top:20px">You’re getting this because of a purchase at driftsky.app.</p>
</div></body></html>`;
}

export function licenseEmail(opts: { key: string; seats: number; publicUrl: string; support: string }): Omit<Mail, 'to'> {
  const computers = opts.seats === 1 ? '1 computer' : `up to ${opts.seats} computers`;
  const text = `Thanks for buying Driftsky.

Your Driftsky license key:

    ${opts.key}

It works on ${computers}, Mac or PC.

1. Download Driftsky: ${opts.publicUrl}/download (Mac) or ${opts.publicUrl}/download/windows (Windows)
2. Open it and paste the key above.
3. Pick the weather.

Moving to a new computer? Remove the key in the app on the old one first, then paste it on the new one.

Questions? Just reply, or write to ${opts.support}.`;
  const html = layout(
    'Your Driftsky license key',
    `<p style="margin:0 0 16px;line-height:1.5">Thanks for buying Driftsky. Here’s your key. It works on ${computers}, Mac or PC.</p>
<div style="font-family:ui-monospace,Menlo,monospace;font-size:18px;letter-spacing:1px;background:#f5f5f7;border-radius:10px;padding:16px;text-align:center;user-select:all">${esc(opts.key)}</div>
<ol style="line-height:1.7;padding-left:20px;margin:20px 0 0">
<li>Download Driftsky for <a href="${esc(opts.publicUrl)}/download">Mac</a> or <a href="${esc(opts.publicUrl)}/download/windows">Windows</a>.</li>
<li>Open it and paste the key above.</li>
<li>Pick the weather.</li>
</ol>
<p style="color:#6e6e73;font-size:14px;line-height:1.5;margin-top:20px">Moving to a new computer? Remove the key in the app on the old one, then paste it on the new one. Questions? Write to <a href="mailto:${esc(opts.support)}">${esc(opts.support)}</a>.</p>`,
  );
  return { subject: 'Your Driftsky license key', text, html };
}

export function upgradeEmail(opts: { key: string; support: string }): Omit<Mail, 'to'> {
  const text = `Your Driftsky key now works on up to 5 computers:\n\n    ${opts.key}\n\nNothing to do on computers that already have it. Questions? ${opts.support}`;
  const html = layout(
    'Your key now covers 5 computers',
    `<p style="line-height:1.5;margin:0 0 16px">Same key, more room. Paste it on up to 5 Macs or PCs.</p><div style="font-family:ui-monospace,Menlo,monospace;font-size:18px;background:#f5f5f7;border-radius:10px;padding:16px;text-align:center">${esc(opts.key)}</div>`,
  );
  return { subject: 'Your Driftsky key now covers 5 computers', text, html };
}

export function keysReminderEmail(opts: { keys: Array<{ key: string; seats: number }>; support: string }): Omit<Mail, 'to'> {
  const list = opts.keys.map((k) => `    ${k.key}  (${k.seats === 1 ? '1 computer' : `${k.seats} computers`})`).join('\n');
  const text = `Here ${opts.keys.length === 1 ? 'is your Driftsky key' : 'are your Driftsky keys'}:\n\n${list}\n\nQuestions? ${opts.support}`;
  const html = layout(
    'Your Driftsky key',
    opts.keys
      .map((k) => `<div style="font-family:ui-monospace,Menlo,monospace;font-size:17px;background:#f5f5f7;border-radius:10px;padding:14px;text-align:center;margin-bottom:8px">${esc(k.key)}</div><p style="color:#6e6e73;font-size:13px;margin:0 0 14px;text-align:center">${k.seats === 1 ? '1 computer' : `${k.seats} computers`}</p>`)
      .join(''),
  );
  return { subject: 'Your Driftsky license key', text, html };
}

export function offerEmail(opts: { code: string; plan: string; publicUrl: string }): Omit<Mail, 'to'> {
  const text = `Still thinking about Driftsky? Here’s 20% off the ${opts.plan} plan. Use code ${opts.code} at checkout within 48 hours: ${opts.publicUrl}/#pricing`;
  const html = layout(
    '20% off, for the next 48 hours',
    `<p style="line-height:1.5;margin:0 0 16px">Still thinking about Driftsky? Here’s 20% off the ${esc(opts.plan)} plan. The code works once, for 48 hours.</p><div style="font-family:ui-monospace,Menlo,monospace;font-size:18px;background:#f5f5f7;border-radius:10px;padding:16px;text-align:center">${esc(opts.code)}</div><p style="margin-top:20px"><a href="${esc(opts.publicUrl)}/#pricing" style="background:#1f6fe0;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;display:inline-block">Pick up where you left off</a></p>`,
  );
  return { subject: '20% off Driftsky for 48 hours', text, html };
}
