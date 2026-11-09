import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** A tiny client-side router: a handful of static pages doesn't need a library. */
export function usePath() {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    window.addEventListener('ds:navigate', on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('ds:navigate', on);
    };
  }, []);
  return path.replace(/\/+$/, '') || '/';
}

export function navigate(href: string) {
  const url = new URL(href, location.href);
  const samePage = url.pathname === location.pathname;
  history.pushState(null, '', url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event('ds:navigate'));
  if (url.hash) scrollToHash(url.hash, samePage);
  else window.scrollTo({ top: 0 });
}

export function scrollToHash(hash: string, smooth = true) {
  const go = () => {
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (el) el.scrollIntoView({ behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto', block: 'start' });
  };
  // wait a frame so a newly rendered page has its sections
  requestAnimationFrame(() => requestAnimationFrame(go));
}

/** <a> that routes in-app for internal links and leaves server routes (/download, /api) alone. */
export function Link({ href = '/', onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!isAppRoute(href)) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}

const APP_ROUTES = ['/', '/terms', '/privacy', '/refunds', '/thanks', '/lost-key'];
function isAppRoute(href: string) {
  if (href.startsWith('#')) return true;
  if (!href.startsWith('/')) return false;
  const p = new URL(href, location.origin).pathname.replace(/\/+$/, '') || '/';
  return APP_ROUTES.includes(p);
}
