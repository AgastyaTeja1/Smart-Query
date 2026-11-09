import { useCallback, useEffect, useRef, useState } from 'react';
import { EFFECT_INFO, EFFECTS, WALLPAPERS, type EffectId } from '@driftsky/engine';
import { DesktopScene, type SceneWindow, type ScriptFrame } from '../components/DesktopScene';
import { DownloadButtons } from '../components/Chrome';
import { FAQ, PRICE_FIVE, PRICE_ONE, STEPS } from '../content';
import { Link, scrollToHash } from '../router';

export function Home() {
  return (
    <main>
      <Hero />
      <Reels />
      <Effects />
      <Wallpapers />
      <Steps />
      <Pricing />
      <Faq />
    </main>
  );
}

function Title({ a, b, as: Tag = 'h2', id }: { a: string; b: string; as?: 'h1' | 'h2'; id?: string }) {
  return (
    <Tag className={Tag === 'h1' ? 'display' : 'section-title'} id={id}>
      {a}
      <br />
      <span className="soft">{b}</span>
    </Tag>
  );
}

// ---------------------------------------------------------------- hero

const HERO_WINDOWS: SceneWindow[] = [{ id: 'notes', x: 0.3, y: 0.24, w: 0.4, h: 0.36, title: 'Notes' }];

function Hero() {
  const [touched, setTouched] = useState(false);
  return (
    <section className="hero">
      <div className="wrap narrow center">
        <Title as="h1" a="Weather for" b="your desktop." />
        <p className="lede">It drifts down your screen, settles on your windows and tumbles off when you move them. With wallpapers to match.</p>
        <DownloadButtons />
        <p className="fine">
          Pay once, keep it forever · <Link href="/#pricing">from ${PRICE_ONE}, lifetime</Link>
        </p>
        <button type="button" className="chip-btn" onClick={() => scrollToHash('#demo')}>
          See how it works <span aria-hidden="true">↓</span>
        </button>
      </div>
      <div className="wrap laptop-wrap" id="demo">
        <div className="laptop">
          <div className="laptop-lid">
            <DesktopScene
              effect="snow"
              wallpaper="snow"
              windows={HERO_WINDOWS}
              windowStyle="notes"
              draggable
              menubar
              dock
              prewarm={70}
              intensity={1.2}
              label="A desktop with snow settled on a window and the Dock. Drag the window to shake the snow off."
              onInteract={() => setTouched(true)}
              testId="hero"
              className="laptop-screen"
            >
              <div className={`drag-hint ${touched ? 'gone' : ''}`} aria-hidden={touched}>
                <span className="drag-dot" /> Drag the window. Shake the snow off.
              </div>
            </DesktopScene>
          </div>
          <div className="laptop-base" />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- reels (scripted live demos)

const W1: SceneWindow = { id: 'w', x: 0.12, y: 0.32, w: 0.76, h: 0.3 };

/** Smooth 0→1→0 pulse over a period, so scripted windows ease rather than jump. */
const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));

const REELS: Array<{ caption: string; effect: EffectId; wallpaper: (typeof WALLPAPERS)[number]['id']; dock?: boolean; script: (t: number) => ScriptFrame; windows: SceneWindow[] }> = [
  {
    caption: 'Narrow a window and the snow drops off the edge',
    effect: 'snow',
    wallpaper: 'snow',
    windows: [W1],
    script: (t) => {
      const c = t % 12;
      const k = c < 8 ? 0 : c < 9 ? ease(c - 8) : c < 11 ? 1 : 1 - ease(c - 11);
      return { windows: [{ ...W1, w: W1.w - k * 0.36 }] };
    },
  },
  {
    caption: 'Throw it across the screen and the snow flies',
    effect: 'snow',
    wallpaper: 'snow',
    windows: [W1],
    script: (t) => {
      const c = t % 10;
      const k = c < 7 ? 0 : c < 7.5 ? ease((c - 7) * 2) : c < 9 ? 1 : 1 - ease(c - 9);
      return { windows: [{ ...W1, x: W1.x + k * 0.04, y: W1.y - k * 0.18 + (c > 7 && c < 7.5 ? Math.sin((c - 7) * 25) * 0.02 : 0) }] };
    },
  },
  {
    caption: 'It settles on the Dock too',
    effect: 'snow',
    wallpaper: 'fireflies',
    dock: true,
    windows: [{ id: 'w', x: 0.18, y: 0.26, w: 0.64, h: 0.24 }],
    script: () => ({}),
  },
  {
    caption: 'Sweep the pointer through the leaves',
    effect: 'leaves',
    wallpaper: 'autumn',
    windows: [W1],
    script: (t) => {
      const c = t % 8;
      if (c < 5) return { pointer: null };
      const k = (c - 5) / 1.2;
      return { pointer: k <= 1 ? { x: 0.05 + k * 0.95, y: W1.y - 0.01 } : null };
    },
  },
];

function Reels() {
  return (
    <section className="section">
      <div className="wrap narrow center">
        <Title a="Throw a window." b="Watch the snow go." />
        <p className="lede">Everything below is the real effect, running live in your browser. Snow builds up on your windows, and when you move one, it slides right off.</p>
      </div>
      <div className="reels" role="list">
        {REELS.map((r, i) => (
          <div className="reel" role="listitem" key={i}>
            <DesktopScene effect={r.effect} wallpaper={r.wallpaper} windows={r.windows} dock={r.dock} script={r.script} prewarm={r.effect === 'snow' ? 60 : 30} intensity={1.6} label={r.caption} testId={`reel-${i}`} />
            <span className="reel-caption">{r.caption}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- effects grid

const CARD_WINDOW: SceneWindow[] = [{ id: 'w', x: 0.18, y: 0.46, w: 0.46, h: 0.36 }];

function Effects() {
  return (
    <section className="section" id="effects">
      <div className="wrap center">
        <Title a="Six kinds of weather." b="Choose one, change any time." />
      </div>
      <div className="wrap grid-2 effects">
        {EFFECTS.map((id) => {
          const e = EFFECT_INFO[id];
          return (
            <article className="effect-card" key={id} data-effect={id}>
              <h3>
                {e.name}.<br />
                <span className="soft">{e.tagline}</span>
              </h3>
              <p>{e.detail}</p>
              <DesktopScene
                effect={id}
                wallpaper={e.wallpaper}
                windows={CARD_WINDOW}
                draggable
                prewarm={id === 'snow' ? 60 : id === 'sakura' || id === 'leaves' ? 30 : 4}
                intensity={1.3}
                label={`${e.name} effect over the ${e.wallpaper} wallpaper. ${e.detail}`}
                className="card-scene"
                testId={`effect-${id}`}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- wallpapers

function Wallpapers() {
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <section className="section" id="wallpapers">
      <div className="wrap center">
        <Title a="Wallpapers to match." b="One click, every screen." />
      </div>
      <div className="wrap wallpapers" role="list">
        {WALLPAPERS.map((w) => (
          <figure key={w.id} role="listitem">
            <button type="button" className="wp-thumb" onClick={() => setOpen(w.id)} aria-label={`Preview the ${w.name} wallpaper`}>
              <img src={`/wallpapers/thumbs/${w.id}.jpg`} alt="" width={720} height={450} loading="lazy" />
            </button>
            <figcaption>{w.name}</figcaption>
          </figure>
        ))}
      </div>
      {open && <Lightbox id={open} onClose={close} />}
    </section>
  );
}

function Lightbox({ id, onClose }: { id: string; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', key);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [onClose]);
  const name = WALLPAPERS.find((w) => w.id === id)?.name;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${name} wallpaper`} onClick={onClose}>
      <img src={`/wallpapers/${id}.jpg`} alt={`${name} wallpaper`} onClick={(e) => e.stopPropagation()} />
      <button ref={ref} type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- steps

function Steps() {
  return (
    <section className="section">
      <div className="wrap center">
        <Title a="Ready in a minute." b="Three steps, nothing to set up." />
      </div>
      <ol className="wrap steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="step-n">{i + 1}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- pricing

function Pricing() {
  return (
    <section className="section" id="pricing">
      <div className="wrap narrow center">
        <Title a="Pay once." b="Keep it for good." />
        <p className="lede">Every effect, every wallpaper, every update. No subscription.</p>
      </div>
      <div className="wrap plans">
        <Plan name="1 computer" price={PRICE_ONE} lines={['1 Mac or PC', 'Everything included', 'All future updates']} plan="one" />
        <Plan name="5 computers" price={PRICE_FIVE} lines={['Up to 5 Macs or PCs', 'Everything included', 'All future updates']} plan="five" best />
      </div>
      <p className="fine center">
        macOS 14 or later · Windows 10 or 11 · <a href="/download">Download for Mac</a> · <a href="/download/windows">Download for Windows</a>
      </p>
    </section>
  );
}

function Plan({ name, price, lines, plan, best }: { name: string; price: number; lines: string[]; plan: 'one' | 'five'; best?: boolean }) {
  return (
    <div className={`plan ${best ? 'best' : ''}`} data-plan={plan}>
      {best && <span className="badge">Best value</span>}
      <h3>{name}</h3>
      <div className="price">${price}</div>
      <p className="once">once, yours for good</p>
      <ul>
        {lines.map((l) => (
          <li key={l}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {l}
          </li>
        ))}
      </ul>
      <a className={best ? 'btn-primary' : 'btn-soft'} href={`/api/checkout?plan=${plan}`} data-testid={`buy-${plan}`}>
        Buy for ${price}
      </a>
    </div>
  );
}

// ---------------------------------------------------------------- faq

function Faq() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="section faq" id="faq">
      <div className="wrap faq-grid">
        <Title a="Good to know" b="before you buy." />
        <div className="faq-list">
          {FAQ.map((f, i) => {
            const isOpen = open === i;
            return (
              <div className={`faq-item ${isOpen ? 'open' : ''}`} key={f.q}>
                <h3>
                  <button type="button" aria-expanded={isOpen} aria-controls={`faq-${i}`} id={`faq-q-${i}`} onClick={() => setOpen(isOpen ? null : i)}>
                    {f.q}
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </h3>
                <div className="faq-a" id={`faq-${i}`} role="region" aria-labelledby={`faq-q-${i}`} hidden={!isOpen}>
                  <p>
                    {f.a}
                    {f.link && (
                      <>
                        {' '}
                        <Link href={f.link.href}>{f.link.label}</Link>
                      </>
                    )}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
