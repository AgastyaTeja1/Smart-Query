import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { WeatherEngine, FrameLoop, type EffectId, type WallpaperId, type Ctx2D } from '@driftsky/engine';

/** A window in screen fractions (0..1), so scenes scale with their container. */
export interface SceneWindow {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
}

export interface ScriptFrame {
  windows?: SceneWindow[];
  pointer?: { x: number; y: number } | null;
}

interface Props {
  effect: EffectId;
  wallpaper: WallpaperId;
  windows: SceneWindow[];
  draggable?: boolean;
  menubar?: boolean;
  dock?: boolean;
  /** Seconds of weather to simulate before the scene first appears (so snow has already piled). */
  prewarm?: number;
  intensity?: number;
  /** Drive windows/pointer over time (seconds since start) for the "reel" demos. */
  script?: (t: number) => ScriptFrame;
  className?: string;
  label: string;
  windowStyle?: 'card' | 'notes';
  onInteract?: () => void;
  /** Exposes the engine for tests: window.__scenes[testId]. */
  testId?: string;
  children?: ReactNode;
}

const DOCK = { w: 0.46, h: 0.075, bottom: 0.018 };
const MENUBAR = 0.034;

declare global {
  interface Window {
    __scenes?: Record<string, { engine: WeatherEngine; windows: () => SceneWindow[] }>;
  }
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function DesktopScene(props: Props) {
  const { effect, wallpaper, draggable = false, menubar = false, dock = false, prewarm = 0, intensity = 1, script, label, windowStyle = 'card' } = props;
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wins, setWins] = useState<SceneWindow[]>(props.windows);
  const winsRef = useRef(wins);
  winsRef.current = wins;
  const [ready, setReady] = useState(false);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const engineRef = useRef<WeatherEngine | null>(null);
  const dragRef = useRef<{ id: string; px: number; py: number; ox: number; oy: number } | null>(null);
  const onInteract = useRef(props.onInteract);
  onInteract.current = props.onInteract;

  useEffect(() => {
    const screen = screenRef.current!;
    const canvas = canvasRef.current!;
    const engine = new WeatherEngine({
      effect,
      intensity,
      createCanvas: (w, h) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c as never;
      },
    });
    engineRef.current = engine;
    let ctx: CanvasRenderingContext2D | null = null;
    let dpr = 1;

    const toPx = (list: SceneWindow[]) => {
      const { w, h } = sizeRef.current;
      return list.map((s) => ({ id: s.id, x: s.x * w, y: s.y * h, w: s.w * w, h: s.h * h }));
    };
    const syncWorld = (t: number) => {
      const { w, h } = sizeRef.current;
      let list = winsRef.current;
      let pointer = pointerRef.current;
      if (script) {
        const f = script(t);
        if (f.windows) {
          list = f.windows;
          winsRef.current = list;
          applyWindowStyles(screen, list);
        }
        if (f.pointer !== undefined) pointer = f.pointer ? { x: f.pointer.x * w, y: f.pointer.y * h } : null;
      }
      engine.setWindows(toPx(list));
      engine.setFloor(dock ? { x: ((1 - DOCK.w) / 2) * w, y: (1 - DOCK.bottom - DOCK.h) * h, w: DOCK.w * w, h: DOCK.h * h } : null);
      engine.setPointer(pointer);
    };

    const measure = () => {
      const r = screen.getBoundingClientRect();
      if (!r.width) return;
      sizeRef.current = { w: r.width, h: r.height };
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      engine.resize(r.width, r.height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(screen);

    let simT = 0;
    const loop = new FrameLoop(
      {
        update: (dt: number) => {
          simT += dt;
          syncWorld(simT);
          engine.update(dt);
        },
        draw: (c: Ctx2D) => engine.draw(c),
      } as unknown as WeatherEngine,
      () => ctx as unknown as Ctx2D,
    );

    let warmed = false;
    let cancelled = false;
    /** Start mid-storm: place settled snow/petals directly (fast), then fill the air. */
    const warm = (done: () => void) => {
      if (!warmed) {
        warmed = true;
        syncWorld(0);
        engine.settle(prewarm);
      }
      done();
    };

    let visible = false;
    const start = () => {
      if (!visible || document.hidden) return;
      warm(() => {
        if (cancelled) return;
        setReady(true);
        if (reducedMotion()) {
          syncWorld(0);
          if (ctx) engine.draw(ctx as unknown as Ctx2D);
        } else if (visible && !document.hidden) loop.start();
      });
    };
    const io = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
        if (visible) start();
        else loop.stop();
      },
      { rootMargin: '200px' },
    );
    io.observe(screen);
    const onVis = () => (document.hidden ? loop.stop() : start());
    document.addEventListener('visibilitychange', onVis);

    if (props.testId) {
      window.__scenes ??= {};
      window.__scenes[props.testId] = { engine, windows: () => winsRef.current };
    }
    return () => {
      cancelled = true;
      loop.stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      if (props.testId && window.__scenes) delete window.__scenes[props.testId];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect]);

  useEffect(() => {
    engineRef.current?.setIntensity(intensity);
  }, [intensity]);

  // ---- pointer: drives leaves/fireflies, and window dragging ----
  const local = (e: RPointerEvent) => {
    const r = screenRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, r };
  };
  const onMove = (e: RPointerEvent) => {
    const p = local(e);
    pointerRef.current = { x: p.x, y: p.y };
    const d = dragRef.current;
    if (!d) return;
    const fx = (p.x - d.px) / p.r.width;
    const fy = (p.y - d.py) / p.r.height;
    setWins((list) =>
      list.map((w) => {
        if (w.id !== d.id) return w;
        const x = clamp(d.ox + fx, -w.w * 0.6, 1 - w.w * 0.4);
        const y = clamp(d.oy + fy, menubar ? MENUBAR : 0, 0.92);
        return { ...w, x, y };
      }),
    );
  };
  const onDown = (e: RPointerEvent, id: string) => {
    if (!draggable) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = local(e);
    const w = winsRef.current.find((x) => x.id === id)!;
    dragRef.current = { id, px: p.x, py: p.y, ox: w.x, oy: w.y };
    // bring to front
    setWins((list) => [list.find((x) => x.id === id)!, ...list.filter((x) => x.id !== id)]);
    onInteract.current?.();
  };
  const onUp = () => (dragRef.current = null);

  // windows render back-to-front so the first in the list is on top
  const ordered = [...wins].reverse();

  return (
    <div
      ref={screenRef}
      className={`scene ${props.className ?? ''}`}
      style={{ backgroundImage: `url(/wallpapers/thumbs/${wallpaper}.jpg)` } as CSSProperties}
      data-wallpaper={wallpaper}
      role="img"
      aria-label={label}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => (pointerRef.current = null)}
      data-testid={props.testId}
    >
      <img className="scene-hd" src={`/wallpapers/${wallpaper}.jpg`} alt="" loading="lazy" decoding="async" onLoad={(e) => e.currentTarget.classList.add('in')} />
      {menubar && <MenuBar />}
      {ordered.map((w, i) => (
        <div
          key={w.id}
          data-win={w.id}
          className={`fake-window ${windowStyle} ${draggable ? 'draggable' : ''}`}
          style={{ left: pct(w.x), top: pct(w.y), width: pct(w.w), height: pct(w.h), zIndex: 10 + i }}
          onPointerDown={(e) => onDown(e, w.id)}
        >
          <div className="fw-bar">
            <i style={{ background: '#ff5f57' }} />
            <i style={{ background: '#febc2e' }} />
            <i style={{ background: '#28c840' }} />
            {w.title && <span>{w.title}</span>}
          </div>
          <div className="fw-body">
            <b />
            <b style={{ width: '62%' }} />
            <b style={{ width: '78%' }} />
            {windowStyle === 'notes' && (
              <>
                <b style={{ width: '70%' }} />
                <b style={{ width: '45%' }} />
              </>
            )}
          </div>
        </div>
      ))}
      {dock && <Dock />}
      <canvas ref={canvasRef} className={`scene-fx ${ready ? 'ready' : ''}`} aria-hidden="true" />
      {props.children}
    </div>
  );
}

/** Scripted reels move windows imperatively (no React re-render per frame). */
function applyWindowStyles(screen: HTMLElement, list: SceneWindow[]) {
  for (const w of list) {
    const el = screen.querySelector<HTMLElement>(`[data-win="${w.id}"]`);
    if (!el) continue;
    el.style.left = pct(w.x);
    el.style.top = pct(w.y);
    el.style.width = pct(w.w);
    el.style.height = pct(w.h);
  }
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function MenuBar() {
  const [time, setTime] = useState(() => clock());
  useEffect(() => {
    const id = setInterval(() => setTime(clock()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="menubar" aria-hidden="true">
      <span className="mb-logo">●</span>
      <b>Finder</b>
      <span>File</span>
      <span>Edit</span>
      <span>View</span>
      <span>Go</span>
      <span>Window</span>
      <span>Help</span>
      <span className="mb-right">
        <svg viewBox="0 0 32 32" className="mb-tray">
          <path d="M8.5 17.5 a4 4 0 0 1 1.3-7.7 a6 6 0 0 1 11.3-1 a4.6 4.6 0 0 1 2.3 8.7 z" fill="currentColor" />
          <circle cx="11" cy="22" r="1.6" fill="currentColor" />
          <circle cx="16" cy="25" r="1.8" fill="currentColor" />
          <circle cx="21" cy="21.5" r="1.4" fill="currentColor" />
        </svg>
        <span>{time}</span>
      </span>
    </div>
  );
}

function clock() {
  return new Date().toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const DOCK_APPS = [
  'linear-gradient(#5ac8fa,#007aff)',
  'linear-gradient(#d1d1d6,#8e8e93)',
  'linear-gradient(#ffd60a,#ff9f0a)',
  'linear-gradient(#5b6cff,#2f9bff)',
  'linear-gradient(#34c759,#248a3d)',
  'linear-gradient(#ff6482,#ff2d55)',
];

function Dock() {
  return (
    <div className="dock" aria-hidden="true" style={{ width: pct(DOCK.w), height: pct(DOCK.h), bottom: pct(DOCK.bottom) }}>
      {DOCK_APPS.map((bg, i) => (
        <i key={i} style={{ background: bg }} />
      ))}
      <em />
      <i style={{ background: 'linear-gradient(#f2f2f7,#c7c7cc)' }} />
    </div>
  );
}
