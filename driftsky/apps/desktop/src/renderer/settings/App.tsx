import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EFFECT_INFO, EFFECTS, WALLPAPERS, WeatherEngine, FrameLoop, type Ctx2D, type EffectId } from '@driftsky/engine';
import type { ActionResult, AppState } from '../../shared/types';
import type { DriftskyApi } from '../../preload/settings';

declare global {
  interface Window {
    driftsky: DriftskyApi;
  }
}
const api = () => window.driftsky;

type Tab = 'effects' | 'wallpapers' | 'license' | 'settings' | 'about';
const TABS: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: 'effects', label: 'Effects', icon: <Icon d="M7 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.6 1.5A3.5 3.5 0 0 1 17.5 15zM9 19l-.5 1.5M13 18l-.5 1.5M16.5 19l-.5 1.5" /> },
  { id: 'wallpapers', label: 'Wallpapers', icon: <Icon d="M4 6h16v12H4zM4 15l4.5-4.5 4 4L15 12l5 5" /> },
  { id: 'license', label: 'License', icon: <Icon d="M14 10a4 4 0 1 0-3.9 4L9 15H7v2H5v2H3v-3l6.6-6.6A4 4 0 0 0 14 10zM15.5 8.5h.01" /> },
  { id: 'settings', label: 'Settings', icon: <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.5 7.5 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.6a7.5 7.5 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7.5 7.5 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 1.7-1l2.3 1 2-3.4z" /> },
  { id: 'about', label: 'About', icon: <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01" /> },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function tabFromHash(): Tab | 'welcome' {
  const h = location.hash.slice(1);
  return h === 'welcome' || TABS.some((t) => t.id === h) ? (h as Tab | 'welcome') : 'effects';
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab | 'welcome'>(tabFromHash);

  useEffect(() => {
    api().getState().then(setState);
    const offState = api().onState(setState);
    const offNav = api().onNavigate((t) => setTab(t as Tab));
    return () => {
      offState();
      offNav();
    };
  }, []);

  if (!state) return <div className="loading" />;
  if (tab === 'welcome' && !state.settings.onboarded) return <Welcome state={state} onDone={() => setTab('effects')} />;
  const current = tab === 'welcome' ? 'effects' : tab;

  return (
    <div className={`app ${state.platform}`}>
      <aside className="sidebar">
        <div className="drag-region" />
        <div className="side-brand">
          <img src="./icon.png" alt="" width={36} height={36} />
          <div>
            <b>Driftsky</b>
            <span>{state.running ? `${EFFECT_INFO[state.settings.effect as EffectId]?.name ?? ''} is falling` : state.license.status === 'active' ? (state.settings.effect === 'off' ? 'Weather is off' : 'Paused') : 'Not activated'}</span>
          </div>
        </div>
        <nav role="tablist" aria-label="Settings sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={current === t.id} className={current === t.id ? 'active' : ''} onClick={() => setTab(t.id)} data-tab={t.id}>
              {t.icon}
              {t.label}
              {t.id === 'license' && state.license.status !== 'active' && <i className="dot" aria-label="needs attention" />}
              {t.id === 'about' && (state.update.status === 'available' || state.update.status === 'ready') && <i className="dot" aria-label="update available" />}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content" role="tabpanel">
        <div className="drag-region" />
        {current === 'effects' && <EffectsTab state={state} goLicense={() => setTab('license')} />}
        {current === 'wallpapers' && <WallpapersTab state={state} />}
        {current === 'license' && <LicenseTab state={state} />}
        {current === 'settings' && <SettingsTab state={state} />}
        {current === 'about' && <AboutTab state={state} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- shared bits

function Header({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="tab-head">
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </header>
  );
}

function Switch({ label, detail, checked, onChange, id }: { label: string; detail?: string; checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <div className="row">
      <label htmlFor={id}>
        <b>{label}</b>
        {detail && <span>{detail}</span>}
      </label>
      <button id={id} role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <i />
      </button>
    </div>
  );
}

function Notice({ result }: { result: ActionResult | null }) {
  if (!result?.message) return null;
  return (
    <p className={`notice ${result.ok ? 'good' : 'bad'}`} role={result.ok ? 'status' : 'alert'}>
      {result.message}
    </p>
  );
}

/** A small live preview of an effect over its wallpaper. */
function LivePreview({ effect, wallpaper, running }: { effect: EffectId; wallpaper: string; running: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const w = c.clientWidth || 200;
    const h = c.clientHeight || 125;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const e = new WeatherEngine({
      effect,
      intensity: 1.4,
      createCanvas: (a, b) => Object.assign(document.createElement('canvas'), { width: a, height: b }) as never,
    });
    e.resize(w, h);
    e.setWindows([{ id: 'w', x: w * 0.22, y: h * 0.48, w: w * 0.56, h: h * 0.4 }]);
    e.settle(effect === 'snow' ? 70 : 40);
    e.setPointer({ x: w * 0.7, y: h * 0.3 });
    const loop = new FrameLoop(e, () => ctx as unknown as Ctx2D);
    loop.maxFps = 30;
    if (running && !matchMedia('(prefers-reduced-motion: reduce)').matches) loop.start();
    else {
      e.update(1 / 30);
      e.draw(ctx as unknown as Ctx2D);
    }
    return () => loop.stop();
  }, [effect, running]);
  return (
    <div className="preview" style={{ backgroundImage: `url(./thumbs/${wallpaper}.jpg)` }}>
      <div className="mini-window" />
      <canvas ref={ref} aria-hidden="true" />
    </div>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = useCallback(async (fn: () => Promise<ActionResult | void>) => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fn();
      if (r) setResult(r);
      return r;
    } catch {
      const r = { ok: false as const, message: 'Something went wrong. Try again.' };
      setResult(r);
      return r;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, result, run, setResult };
}

// ---------------------------------------------------------------- effects

function LockedBanner({ state, goLicense }: { state: AppState; goLicense: () => void }) {
  const a = useAction();
  if (state.license.status === 'active' || state.preview.active) return null;
  return (
    <div className="banner">
      <div>
        <b>{state.license.status === 'invalid' ? 'Your key needs attention' : 'Add your key to start the weather'}</b>
        <span>{state.license.message ?? 'Paste the key from your email, or try Driftsky for a minute first.'}</span>
      </div>
      <div className="banner-actions">
        {!state.preview.used && (
          <button className="btn" onClick={() => a.run(() => api().preview())} disabled={a.busy}>
            Try for a minute
          </button>
        )}
        <button className="btn primary" onClick={goLicense}>
          Enter key
        </button>
      </div>
    </div>
  );
}

function EffectsTab({ state, goLicense }: { state: AppState; goLicense: () => void }) {
  const s = state.settings;
  const allowed = state.license.status === 'active' || state.preview.active;
  const a = useAction();
  return (
    <section>
      <Header title="Effects" sub="Choose the weather. It falls over every screen and settles on your windows." />
      <LockedBanner state={state} goLicense={goLicense} />
      {state.preview.active && <p className="notice good">Preview: the weather stays for a minute. Add a key to keep it.</p>}
      <div className="effect-grid" role="radiogroup" aria-label="Effect">
        {EFFECTS.map((id) => {
          const info = EFFECT_INFO[id];
          const selected = s.effect === id;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={selected}
              className={`effect-tile ${selected ? 'selected' : ''}`}
              data-effect={id}
              onClick={() => (allowed ? a.run(() => api().setEffect(id)) : goLicense())}
            >
              <LivePreview effect={id} wallpaper={info.wallpaper} running={selected || id === 'snow'} />
              <span className="tile-text">
                <b>{info.name}</b>
                <span>{info.tagline}</span>
              </span>
              {selected && <i className="check" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <Notice result={a.result} />
      <div className="group">
        <Switch id="weather-on" label="Weather" detail={s.effect === 'off' ? 'Off. Your screen stays clear.' : 'On'} checked={s.effect !== 'off'} onChange={(v) => (allowed ? a.run(() => api().setEffect(v ? s.lastEffect : 'off')) : goLicense())} />
        <div className="row">
          <label>
            <b>Amount</b>
            <span>How much falls at once.</span>
          </label>
          <div className="segmented" role="radiogroup" aria-label="Amount">
            {[
              ['Light', 0.5],
              ['Normal', 1],
              ['Heavy', 1.6],
            ].map(([label, v]) => (
              <button key={label} role="radio" aria-checked={Math.abs(s.intensity - (v as number)) < 0.01} className={Math.abs(s.intensity - (v as number)) < 0.01 ? 'on' : ''} onClick={() => api().setSettings({ intensity: v as number })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <Switch id="behind" label="Behind windows" detail="Fall only on the desktop, under your apps." checked={s.behindWindows} onChange={(v) => api().setSettings({ behindWindows: v })} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- wallpapers

function WallpapersTab({ state }: { state: AppState }) {
  const a = useAction();
  const [pending, setPending] = useState<string | null>(null);
  return (
    <section>
      <Header title="Wallpapers" sub="Painted to match the weather. Click one to set it on every screen." />
      <div className="wp-grid">
        {WALLPAPERS.map((w) => {
          const current = state.settings.wallpaper === w.id;
          return (
            <button
              key={w.id}
              className={`wp ${current ? 'selected' : ''}`}
              data-wallpaper={w.id}
              aria-pressed={current}
              disabled={a.busy}
              onClick={async () => {
                setPending(w.id);
                await a.run(async () => {
                  const r = await api().setWallpaper(w.id);
                  return r.ok ? { ok: true, message: `${w.name} is now your wallpaper.` } : r;
                });
                setPending(null);
              }}
            >
              <img src={`./thumbs/${w.id}.jpg`} alt="" />
              <span>
                {w.name}
                {pending === w.id && ' · setting…'}
              </span>
              {current && <i className="check" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <Notice result={a.result} />
    </section>
  );
}

// ---------------------------------------------------------------- license

function LicenseTab({ state }: { state: AppState }) {
  const l = state.license;
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [offerForce, setOfferForce] = useState(false);
  const a = useAction();

  if (l.status === 'active' && l.key) {
    const seats = l.seats ?? 1;
    return (
      <section>
        <Header title="License" sub="Driftsky is unlocked on this computer." />
        <div className="group">
          <div className="row">
            <label>
              <b>Bought with</b>
              <span data-testid="license-email">{l.email}</span>
            </label>
          </div>
          <div className="row">
            <label>
              <b>Key</b>
              <code className="key" data-testid="license-key">
                {reveal ? l.key : l.key.replace(/(?<=DRIFT-....-).+/, '••••-••••-••••')}
              </code>
            </label>
            <div className="row-actions">
              <button className="btn" onClick={() => setReveal(!reveal)}>
                {reveal ? 'Hide' : 'Show'}
              </button>
              <button className="btn" onClick={() => navigator.clipboard.writeText(l.key!).then(() => a.setResult({ ok: true, message: 'Key copied.' }))}>
                Copy
              </button>
            </div>
          </div>
          <div className="row">
            <label>
              <b>Computers</b>
              <span data-testid="license-seats">{seats === 1 ? 'Covers 1 computer' : `In use on ${l.used ?? 1} of ${seats} computers`}</span>
            </label>
            {seats === 1 && (
              <button className="btn primary" onClick={() => api().upgrade()}>
                Upgrade to 5 computers
              </button>
            )}
          </div>
        </div>
        <div className="group">
          <div className="row">
            <label>
              <b>Remove from this computer</b>
              <span>Frees this computer’s place so you can use the key on another one.</span>
            </label>
            {!confirm ? (
              <button className="btn danger" onClick={() => setConfirm(true)}>
                Remove key…
              </button>
            ) : (
              <div className="row-actions">
                <button className="btn" onClick={() => (setConfirm(false), setOfferForce(false))}>
                  Cancel
                </button>
                <button
                  className="btn danger-solid"
                  disabled={a.busy}
                  onClick={async () => {
                    const r = await a.run(() => api().removeKey(offerForce));
                    if (r && !r.ok) setOfferForce(true);
                    else setConfirm(false);
                  }}
                >
                  {offerForce ? 'Remove anyway' : 'Remove'}
                </button>
              </div>
            )}
          </div>
        </div>
        <Notice result={a.result} />
      </section>
    );
  }

  const submit = async () => {
    const r = await a.run(() => api().activate(key));
    if (r?.ok) setKey('');
  };
  return (
    <section>
      <Header title="License" sub="Paste the key from your email to unlock Driftsky on this computer." />
      {l.status === 'invalid' && l.message && <p className="notice bad">{l.message}</p>}
      <form
        className="key-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="key" className="sr-only">
          License key
        </label>
        <input id="key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="DRIFT-XXXX-XXXX-XXXX-XXXX" spellCheck={false} autoComplete="off" autoFocus />
        <button className="btn primary" disabled={a.busy || !key.trim()}>
          {a.busy ? 'Checking…' : 'Activate'}
        </button>
      </form>
      <Notice result={a.result} />
      <div className="group">
        <div className="row">
          <label>
            <b>Don’t have a key yet?</b>
            <span>$9 for 1 computer or $15 for 5. Pay once, keep it forever.</span>
          </label>
          <button className="btn primary" onClick={() => api().buy()}>
            Buy a key
          </button>
        </div>
        <div className="row">
          <label>
            <b>Lost your key?</b>
            <span>Search your inbox for “Driftsky license key”, or have it sent again.</span>
          </label>
          <button className="btn" onClick={() => api().openLink(state.links.lostKey)}>
            Send it again
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- settings

function SettingsTab({ state }: { state: AppState }) {
  const s = state.settings;
  const set = (p: Parameters<DriftskyApi['setSettings']>[0]) => api().setSettings(p);
  return (
    <section>
      <Header title="Settings" />
      <div className="group">
        <Switch id="login" label="Open at login" detail="Start Driftsky when you log in, so the weather is there when you are." checked={s.openAtLogin} onChange={(v) => set({ openAtLogin: v })} />
        <Switch id="battery" label="Battery saver" detail="Half the weather and a lower frame rate on battery." checked={s.batterySaver} onChange={(v) => set({ batterySaver: v })} />
        <Switch id="fullscreen" label="Pause for full-screen apps" detail="Stop while a game, video or presentation fills the screen." checked={s.pauseInFullScreen} onChange={(v) => set({ pauseInFullScreen: v })} />
        <Switch id="updates" label="Check for updates automatically" detail="Every few hours. Nothing installs without you." checked={s.autoUpdate} onChange={(v) => set({ autoUpdate: v })} />
      </div>
      <p className="fine">Clicks always go through the weather to whatever is underneath.</p>
    </section>
  );
}

// ---------------------------------------------------------------- about

function AboutTab({ state }: { state: AppState }) {
  const u = state.update;
  const a = useAction();
  return (
    <section className="about">
      <img src="./icon.png" alt="" width={96} height={96} />
      <h1>Driftsky</h1>
      <p className="version" data-testid="version">
        Version {state.version}
      </p>
      <div className="update-box" aria-live="polite">
        {u.status === 'available' || u.status === 'ready' ? (
          <>
            <p>
              <b>Version {u.version} is available.</b> {u.notes}
            </p>
            <button className="btn primary" onClick={() => a.run(async () => void (await api().installUpdate()))} disabled={a.busy}>
              {u.status === 'ready' ? 'Open installer' : 'Download and install'}
            </button>
          </>
        ) : u.status === 'downloading' ? (
          <>
            <p>Downloading… {Math.round((u.progress ?? 0) * 100)}%</p>
            <progress max={1} value={u.progress ?? 0} />
          </>
        ) : (
          <button className="btn" onClick={() => a.run(async () => void (await api().checkUpdates()))} disabled={u.status === 'checking' || a.busy}>
            {u.status === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        )}
        {u.message && <p className={u.status === 'error' ? 'notice bad' : 'notice good'}>{u.message}</p>}
      </div>
      <nav className="links">
        <button className="link" onClick={() => api().openLink(state.links.site)}>
          driftsky.app
        </button>
        <button className="link" onClick={() => api().openLink(state.links.privacy)}>
          Privacy
        </button>
        <button className="link" onClick={() => api().openLink(state.links.terms)}>
          Terms
        </button>
        <button className="link" onClick={() => api().openLink(state.links.support)}>
          Support
        </button>
      </nav>
    </section>
  );
}

// ---------------------------------------------------------------- first run

function Welcome({ state, onDone }: { state: AppState; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [key, setKey] = useState('');
  const a = useAction();
  const licensed = state.license.status === 'active' || state.preview.active;
  const finish = async () => {
    await api().finishOnboarding();
    onDone();
  };
  return (
    <div className="welcome">
      <div className="drag-region" />
      <ol className="steps-dots" aria-label={`Step ${step + 1} of 3`}>
        {[0, 1, 2].map((i) => (
          <li key={i} className={i === step ? 'on' : ''} />
        ))}
      </ol>
      {step === 0 && (
        <div className="welcome-step">
          <img src="./icon.png" alt="" width={88} height={88} />
          <h1>Weather for your desktop.</h1>
          <p>Driftsky lives in your menu bar. Snow, rain and more fall over your screen and settle on your windows. Clicks always go straight through.</p>
          <button className="btn primary big" onClick={() => setStep(1)} autoFocus>
            Continue
          </button>
        </div>
      )}
      {step === 1 && (
        <div className="welcome-step">
          <h1>Paste your license key</h1>
          <p>It’s in the email we sent when you bought Driftsky.</p>
          {state.license.status === 'active' ? (
            <p className="notice good">Unlocked for {state.license.email}.</p>
          ) : (
            <form
              className="key-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await a.run(() => api().activate(key));
                if (r?.ok) setStep(2);
              }}
            >
              <label htmlFor="wkey" className="sr-only">
                License key
              </label>
              <input id="wkey" value={key} onChange={(e) => setKey(e.target.value)} placeholder="DRIFT-XXXX-XXXX-XXXX-XXXX" spellCheck={false} autoComplete="off" autoFocus />
              <button className="btn primary" disabled={a.busy || !key.trim()}>
                {a.busy ? 'Checking…' : 'Activate'}
              </button>
            </form>
          )}
          <Notice result={a.result} />
          <div className="welcome-alt">
            {state.license.status === 'active' || state.preview.active ? (
              <button className="btn primary big" onClick={() => setStep(2)}>
                Continue
              </button>
            ) : (
              <>
                {!state.preview.used && (
                  <button className="btn" onClick={async () => (await a.run(() => api().preview()))?.ok && setStep(2)}>
                    Try it for a minute
                  </button>
                )}
                <button className="btn" onClick={() => api().buy()}>
                  Buy a key
                </button>
                <button className="link" onClick={finish}>
                  Skip for now
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="welcome-step wide">
          <h1>Pick the weather</h1>
          <p>You can change it any time from the menu bar.</p>
          <div className="effect-grid compact" role="radiogroup" aria-label="Effect">
            {EFFECTS.map((id) => (
              <button key={id} role="radio" aria-checked={state.settings.effect === id} className={`effect-tile ${state.settings.effect === id ? 'selected' : ''}`} data-effect={id} disabled={!licensed} onClick={() => api().setEffect(id)}>
                <LivePreview effect={id} wallpaper={EFFECT_INFO[id].wallpaper} running={state.settings.effect === id} />
                <span className="tile-text">
                  <b>{EFFECT_INFO[id].name}</b>
                </span>
                {state.settings.effect === id && <i className="check" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <button className="btn primary big" onClick={finish}>
            Done
          </button>
          <p className="fine">Look for the cloud in your {state.platform === 'windows' ? 'taskbar tray' : 'menu bar'}.</p>
        </div>
      )}
    </div>
  );
}
