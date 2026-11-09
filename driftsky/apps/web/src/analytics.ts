/**
 * Website analytics, only after consent. Uses PostHog when VITE_POSTHOG_KEY is set at build time;
 * otherwise this is a no-op. The choice is remembered in localStorage.
 */
const KEY = 'ds-consent';
export const CONSENT_EVENT = 'ds:consent';

export function getConsent(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? null : v === 'yes';
  } catch {
    return null;
  }
}

export function setConsent(v: boolean) {
  try {
    localStorage.setItem(KEY, v ? 'yes' : 'no');
  } catch {
    /* private mode: the banner simply shows again next time */
  }
  if (v) load();
  else (window as unknown as { posthog?: { opt_out_capturing?: () => void } }).posthog?.opt_out_capturing?.();
}

let loaded = false;
function load() {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (loaded || !key) return;
  loaded = true;
  const s = document.createElement('script');
  s.src = 'https://us-assets.i.posthog.com/static/array.js';
  s.async = true;
  s.onload = () =>
    (window as unknown as { posthog?: { init: (k: string, o: object) => void } }).posthog?.init(key, {
      api_host: 'https://us.i.posthog.com',
      persistence: 'cookie',
    });
  document.head.appendChild(s);
}

export function initAnalytics() {
  if (getConsent()) load();
}
