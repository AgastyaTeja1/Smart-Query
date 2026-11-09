import { useEffect, useRef, useState } from 'react';
import { Link } from '../router';
import { PRICE_ONE, SUPPORT_EMAIL } from '../content';
import { getConsent, setConsent, CONSENT_EVENT } from '../analytics';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="64 64 896 896" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id="lg-bg" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#5b6cff" />
          <stop offset="1" stopColor="#2f9bff" />
        </linearGradient>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#lg-bg)" />
      <path d="M300 560 a110 110 0 0 1 40-212 a170 170 0 0 1 320-30 a130 130 0 0 1 64 242 z" fill="#fff" />
      <g fill="#fff">
        <circle cx="380" cy="660" r="26" />
        <circle cx="520" cy="720" r="30" />
        <circle cx="650" cy="650" r="22" />
        <circle cx="450" cy="800" r="20" />
        <circle cx="610" cy="820" r="24" />
      </g>
    </svg>
  );
}

export function Header() {
  return (
    <header className="site-header">
      <div className="wrap header-inner">
        <Link href="/" className="brand" aria-label="Driftsky home">
          <Logo />
          <span>Driftsky</span>
        </Link>
        <nav className="main-nav" aria-label="Main">
          <Link href="/#effects">Effects</Link>
          <Link href="/#wallpapers">Wallpapers</Link>
          <Link href="/#pricing">Pricing</Link>
          <Link href="/#faq">FAQ</Link>
        </nav>
        <Link href="/#pricing" className="price-pill">
          <span className="pill-tag">Lifetime</span>
          <span className="pill-price">
            from <b>${PRICE_ONE}</b>
            <span className="pill-once">, once</span>
          </span>
        </Link>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-inner">
        <div className="footer-brand">
          <Link href="/" className="brand muted" aria-label="Driftsky home">
            <Logo />
            <span>Driftsky</span>
          </Link>
          <span className="copy">© {new Date().getFullYear()} Driftsky</span>
        </div>
        <nav className="footer-nav" aria-label="Footer">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/refunds">Refunds</Link>
          <button type="button" className="linklike" onClick={() => window.dispatchEvent(new Event('ds:cookie-settings'))}>
            Cookie settings
          </button>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </nav>
      </div>
    </footer>
  );
}

export function CookieBanner() {
  const [open, setOpen] = useState(false);
  const okRef = useRef<HTMLButtonElement>(null);
  const [focusOnOpen, setFocusOnOpen] = useState(false);
  useEffect(() => {
    // first visit: slide in after a moment, not on top of the first impression
    const t = getConsent() === null ? setTimeout(() => setOpen(true), 3000) : undefined;
    const show = () => {
      setFocusOnOpen(true);
      setOpen(true);
    };
    window.addEventListener('ds:cookie-settings', show);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener('ds:cookie-settings', show);
    };
  }, []);
  useEffect(() => {
    if (open && focusOnOpen) okRef.current?.focus();
  }, [open, focusOnOpen]);
  if (!open) return null;
  const choose = (v: boolean) => {
    setConsent(v);
    window.dispatchEvent(new Event(CONSENT_EVENT));
    setOpen(false);
  };
  return (
    <div className="cookie" role="dialog" aria-live="polite" aria-label="Cookie choice">
      <p>One cookie tells us which parts of this site are useful. It stays on the website.</p>
      <div className="cookie-actions">
        <button type="button" className="btn-quiet" onClick={() => choose(false)}>
          No thanks
        </button>
        <button ref={okRef} type="button" className="btn-dark" onClick={() => choose(true)}>
          OK
        </button>
      </div>
    </div>
  );
}

export function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="currentColor">
      <path d="M16.37 12.6c.02 2.4 2.1 3.2 2.13 3.21-.02.06-.33 1.14-1.1 2.26-.66.97-1.35 1.94-2.43 1.96-1.06.02-1.4-.63-2.62-.63-1.21 0-1.6.61-2.6.65-1.05.04-1.84-1.05-2.51-2.02-1.37-1.97-2.41-5.58-1.01-8.01.7-1.21 1.94-1.97 3.28-1.99 1.03-.02 2 .69 2.62.69.63 0 1.8-.85 3.04-.73.52.02 1.97.21 2.9 1.58-.08.05-1.73 1.01-1.7 3.03M14.4 4.9c.55-.67.93-1.6.83-2.53-.8.03-1.77.53-2.34 1.2-.51.59-.96 1.54-.84 2.45.89.07 1.8-.45 2.35-1.12" />
    </svg>
  );
}

export function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor">
      <path d="M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z" />
    </svg>
  );
}

export function DownloadButtons() {
  return (
    <div className="dl-buttons">
      <a className="dl-btn" href="/download" data-testid="dl-mac">
        <AppleIcon />
        <span>
          <small>Download for</small>
          <b>Mac</b>
        </span>
      </a>
      <a className="dl-btn" href="/download/windows" data-testid="dl-windows">
        <WindowsIcon />
        <span>
          <small>Download for</small>
          <b>Windows</b>
        </span>
      </a>
    </div>
  );
}
