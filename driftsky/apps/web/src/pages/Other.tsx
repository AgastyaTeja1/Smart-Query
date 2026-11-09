import { useEffect, useState, type FormEvent } from 'react';
import { DownloadButtons } from '../components/Chrome';
import { SUPPORT_EMAIL } from '../content';
import { Link } from '../router';

type SessionState =
  | { status: 'loading' }
  | { status: 'pending' }
  | { status: 'paid'; email: string; key: string; seats: number; plan: string }
  | { status: 'expired' | 'missing' | 'error' };

/** After checkout: show the key straight away (it's emailed too), polling until the payment confirms. */
export function Thanks() {
  const id = new URLSearchParams(location.search).get('session_id') ?? '';
  const [s, setS] = useState<SessionState>({ status: 'loading' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return setS({ status: 'missing' });
    let stop = false;
    let tries = 0;
    const poll = async () => {
      try {
        const r = await fetch(`/api/checkout/session?id=${encodeURIComponent(id)}`);
        if (r.status === 404 || r.status === 400) return setS({ status: 'missing' });
        const j = await r.json();
        if (stop) return;
        setS(j);
        if (j.status === 'pending' && tries++ < 40) setTimeout(poll, 1500);
      } catch {
        if (!stop) setS({ status: 'error' });
      }
    };
    poll();
    return () => {
      stop = true;
    };
  }, [id]);

  const copy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the key is selectable */
    }
  };

  return (
    <main className="wrap narrow center page-pad thanks" aria-live="polite">
      {s.status === 'paid' ? (
        <>
          <h1 className="display small">
            You’re all set.
            <br />
            <span className="soft">Here’s your key.</span>
          </h1>
          <div className="key-box" data-testid="license-key">
            <code>{s.key}</code>
            <button type="button" className="btn-soft small" onClick={() => copy(s.key)}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="lede">
            We also sent it to <b>{s.email}</b>. It works on {s.seats === 1 ? '1 computer' : `up to ${s.seats} computers`}, Mac or PC.
          </p>
          <DownloadButtons />
          <p className="fine">Open Driftsky, paste the key, pick the weather.</p>
        </>
      ) : s.status === 'pending' || s.status === 'loading' ? (
        <>
          <h1 className="display small">Confirming your payment…</h1>
          <p className="lede">This usually takes a few seconds. Your key will show up here and in your email.</p>
          <div className="spinner" aria-label="Loading" />
        </>
      ) : (
        <>
          <h1 className="display small">We couldn’t find that order.</h1>
          <p className="lede">
            If you paid, your key is on its way by email. Can’t find it? <Link href="/lost-key">We can send it again</Link>, or write to{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </>
      )}
    </main>
  );
}

export function LostKey() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'done' | 'error'; msg?: string }>({ kind: 'idle' });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState({ kind: 'busy' });
    try {
      const r = await fetch('/api/license/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) });
      const j = await r.json().catch(() => ({}));
      setState(r.ok ? { kind: 'done', msg: j.message } : { kind: 'error', msg: j.message ?? 'That didn’t work. Try again in a minute.' });
    } catch {
      setState({ kind: 'error', msg: 'You seem to be offline. Check your connection and try again.' });
    }
  };
  return (
    <main className="wrap narrow center page-pad">
      <h1 className="display small">
        Lost your key?
        <br />
        <span className="soft">We’ll send it again.</span>
      </h1>
      <p className="lede">Enter the email you bought Driftsky with.</p>
      {state.kind === 'done' ? (
        <p className="notice" role="status">
          {state.msg}
        </p>
      ) : (
        <form className="inline-form" onSubmit={submit}>
          <label htmlFor="lk-email" className="sr-only">
            Email
          </label>
          <input id="lk-email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn-primary" disabled={state.kind === 'busy'}>
            {state.kind === 'busy' ? 'Sending…' : 'Send my key'}
          </button>
        </form>
      )}
      {state.kind === 'error' && (
        <p className="error" role="alert">
          {state.msg}
        </p>
      )}
      <p className="fine">
        Still stuck? Write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </main>
  );
}

export function NotFound() {
  return (
    <main className="wrap narrow center page-pad">
      <h1 className="display small">
        Nothing here.
        <br />
        <span className="soft">Just a little fog.</span>
      </h1>
      <p className="lede">That page doesn’t exist.</p>
      <Link href="/" className="btn-primary">
        Go home
      </Link>
    </main>
  );
}
