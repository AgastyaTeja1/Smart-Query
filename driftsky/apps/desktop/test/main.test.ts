import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Store, DEFAULT_SETTINGS } from '../src/main/store';
import { LicenseManager, normalizeKey, deviceCode, OFFLINE_GRACE_DAYS } from '../src/main/license';
import { buildMenu, statusLine, type MenuSpec } from '../src/main/menu';
import { floorRect, frameFor, isFullScreen } from '../src/main/geometry';
import { Updater, compareVersions } from '../src/main/updater';
import { fileWindowSource } from '../src/main/windowsource';
import type { AppState } from '../src/shared/types';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dsd-'));

describe('Store', () => {
  it('starts with sensible defaults and persists atomically', () => {
    const dir = tmp();
    const s = new Store(dir);
    expect(s.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(s.data.settings.effect).toBe('snow');
    expect(s.data.settings.openAtLogin).toBe(true);
    s.updateSettings({ effect: 'rain', intensity: 1.6 });
    const again = new Store(dir);
    expect(again.data.settings.effect).toBe('rain');
    expect(again.data.settings.lastEffect).toBe('rain');
    expect(again.data.settings.intensity).toBe(1.6);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('keeps the last real effect when turned off, and rejects bad values', () => {
    const s = new Store(tmp());
    s.updateSettings({ effect: 'leaves' });
    s.updateSettings({ effect: 'off' });
    expect(s.data.settings.lastEffect).toBe('leaves');
    s.updateSettings({ effect: 'hail' as never, intensity: 99, wallpaper: '../../etc' as never });
    expect(s.data.settings.effect).toBe('snow');
    expect(s.data.settings.intensity).toBe(1);
    expect(s.data.settings.wallpaper).toBeNull();
  });
  it('recovers from a corrupt file', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'driftsky.json'), '{not json');
    const s = new Store(dir);
    expect(s.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(fs.existsSync(path.join(dir, 'driftsky.json.broken'))).toBe(true);
    fs.writeFileSync(path.join(dir, 'driftsky.json'), '[1,2,3]');
    expect(new Store(dir).data.settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('license key normalisation (matches the server)', () => {
  it('accepts pasted variants', () => {
    const k = 'DRIFT-AB12-CD34-EF56-GH78';
    for (const v of [k, k.toLowerCase(), ` ${k}\n`, 'AB12CD34EF56GH78', 'DRIFT AB12 CD34 EF56 GH78', 'DRIFT–AB12–CD34–EF56–GH78', 'DRIFT-ABI2-CD34-EF56-GH78'])
      expect(normalizeKey(v)).toBe(k);
    for (const v of ['', 'DRIFT', 'DRIFT-AB12-CD34-EF56-GH7', 'DRIFT-AB12-CD34-EF56-GH7U', 'DRIFT-AB12-CD34-EF56-GH78X']) expect(normalizeKey(v)).toBeNull();
    // pasted with surrounding text or punctuation
    for (const v of [
      'License key: DRIFT-AB12-CD34-EF56-GH78',
      'Your key is DRIFT-AB12-CD34-EF56-GH78.',
      'DRIFT-AB12-CD34-EF56-GH78,',
      'DRIFT\u00A0AB12\u00A0CD34\u00A0EF56\u00A0GH78',
    ])
      expect(normalizeKey(v)).toBe(k);
  });
  it('hashes the hardware id', () => {
    expect(deviceCode('abc')).toMatch(/^[a-f0-9]{64}$/);
    expect(deviceCode('abc')).not.toBe(deviceCode('abd'));
  });
});

function fakeServer() {
  const seats = new Map<string, { email: string; seats: number; devices: Set<string>; revoked?: boolean }>();
  seats.set('DRIFT-AAAA-BBBB-CCCC-DDDD', { email: 'a@example.com', seats: 1, devices: new Set() });
  let online = true;
  const calls: string[] = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    if (!online) throw new TypeError('fetch failed');
    const p = new URL(url).pathname;
    calls.push(p);
    const b = JSON.parse(String(init.body));
    const l = seats.get(b.key);
    const json = (status: number, body: object) => new Response(JSON.stringify(body), { status });
    if (!l) return json(404, { error: 'not_found', message: 'nope' });
    if (l.revoked)
      return p.endsWith('validate')
        ? json(200, { valid: false, reason: 'revoked', message: 'turned off' })
        : json(403, { error: 'revoked', message: 'turned off' });
    const view = () => ({ email: l.email, seats: l.seats, used: l.devices.size });
    if (p.endsWith('/deactivate')) return json(200, { ok: true, removed: l.devices.delete(b.device) });
    if (p.endsWith('/activate')) {
      if (!l.devices.has(b.device) && l.devices.size >= l.seats) return json(409, { error: 'seats_full', message: 'full' });
      const already = l.devices.has(b.device);
      l.devices.add(b.device);
      return json(200, { ok: true, key: b.key, already, license: view() });
    }
    if (p.endsWith('/validate'))
      return l.devices.has(b.device)
        ? json(200, { valid: true, license: view() })
        : json(200, { valid: false, reason: 'not_activated', message: 'removed elsewhere' });
    return json(404, {});
  });
  return { f: f as unknown as typeof fetch, seats, calls, setOnline: (v: boolean) => (online = v) };
}

describe('LicenseManager', () => {
  let store: Store;
  let srv: ReturnType<typeof fakeServer>;
  let lm: LicenseManager;
  const changed = vi.fn();
  beforeEach(() => {
    process.env.DRIFTSKY_DEVICE_ID = 'test-device-1';
    store = new Store(tmp());
    srv = fakeServer();
    lm = new LicenseManager(store, 'http://api', 'mac', '1.0.0', changed, srv.f, 'test-device-1');
  });

  it('activates with a pasted key and persists it', async () => {
    const r = await lm.activate('  drift aaaa bbbb cccc dddd ');
    expect(r.ok).toBe(true);
    expect(lm.isLicensed).toBe(true);
    expect(store.data.license).toMatchObject({ status: 'active', key: 'DRIFT-AAAA-BBBB-CCCC-DDDD', email: 'a@example.com', seats: 1, used: 1 });
    expect(changed).toHaveBeenCalled();
  });

  it('explains bad keys, unknown keys, full keys and being offline', async () => {
    expect((await lm.activate('hello')) as { message: string }).toMatchObject({ ok: false, message: expect.stringMatching(/DRIFT-/) });
    expect(srv.calls).toHaveLength(0); // never hits the network for a malformed key
    expect(await lm.activate('DRIFT-ZZZZ-ZZZZ-ZZZZ-ZZZZ')).toMatchObject({ ok: false, message: 'nope' });
    srv.seats.get('DRIFT-AAAA-BBBB-CCCC-DDDD')!.devices.add('someone-else');
    expect(await lm.activate('DRIFT-AAAA-BBBB-CCCC-DDDD')).toMatchObject({ ok: false, message: 'full' });
    srv.setOnline(false);
    expect(await lm.activate('DRIFT-AAAA-BBBB-CCCC-DDDD')).toMatchObject({ ok: false, message: expect.stringMatching(/online/) });
    expect(lm.isLicensed).toBe(false);
  });

  it('removes the key (freeing the seat) and handles offline removal', async () => {
    await lm.activate('DRIFT-AAAA-BBBB-CCCC-DDDD');
    srv.setOnline(false);
    const r = await lm.remove();
    expect(r.ok).toBe(false);
    expect(lm.isLicensed).toBe(true);
    expect((await lm.remove(true)).ok).toBe(true);
    expect(lm.isLicensed).toBe(false);
    srv.setOnline(true);
    await lm.activate('DRIFT-AAAA-BBBB-CCCC-DDDD');
    expect((await lm.remove()).ok).toBe(true);
    expect(srv.seats.get('DRIFT-AAAA-BBBB-CCCC-DDDD')!.devices.size).toBe(0);
  });

  it('notices when the key was removed elsewhere or revoked', async () => {
    await lm.activate('DRIFT-AAAA-BBBB-CCCC-DDDD');
    srv.seats.get('DRIFT-AAAA-BBBB-CCCC-DDDD')!.devices.clear();
    await lm.validate();
    expect(lm.state).toMatchObject({ status: 'invalid', message: 'removed elsewhere' });
    await lm.activate('DRIFT-AAAA-BBBB-CCCC-DDDD');
    srv.seats.get('DRIFT-AAAA-BBBB-CCCC-DDDD')!.revoked = true;
    await lm.validate();
    expect(lm.state.status).toBe('invalid');
  });

  it('keeps working offline for the grace period, then asks to reconnect', async () => {
    await lm.activate('DRIFT-AAAA-BBBB-CCCC-DDDD');
    srv.setOnline(false);
    await lm.validate();
    expect(lm.isLicensed).toBe(true);
    store.setLicense({ ...store.data.license, checkedAt: new Date(Date.now() - (OFFLINE_GRACE_DAYS + 1) * 86_400_000).toISOString() });
    await lm.validate();
    expect(lm.state.status).toBe('invalid');
    expect(lm.state.message).toMatch(/30 days/);
    srv.setOnline(true);
    await lm.validate();
    expect(lm.isLicensed).toBe(true);
  });

  it('builds an upgrade link only for 1-computer keys', async () => {
    expect(await lm.upgradeUrl('https://x')).toBeNull();
    await lm.activate('DRIFT-AAAA-BBBB-CCCC-DDDD');
    const url = (await lm.upgradeUrl('https://x'))!;
    expect(url).toMatch(/^https:\/\/x\/api\/checkout\?plan=upgrade&key=DRIFT-AAAA-BBBB-CCCC-DDDD&device=[a-f0-9]{64}$/);
  });
});

function state(over: Partial<AppState> = {}): AppState {
  return {
    version: '1.0.0',
    platform: 'mac',
    settings: { ...DEFAULT_SETTINGS },
    license: { status: 'active', key: 'DRIFT-AAAA-BBBB-CCCC-DDDD', email: 'a@example.com', seats: 5, used: 2, checkedAt: null, message: null },
    update: { status: 'idle', version: null, notes: null, progress: null, message: null, required: false },
    preview: { active: false, endsAt: null, used: false },
    running: true,
    paused: null,
    onBattery: false,
    canGoBehind: true,
    links: { site: '', buy: '', privacy: '', terms: '', lostKey: '', support: '' },
    ...over,
  };
}
const ids = (m: MenuSpec[]) => m.map((i) => i.id ?? i.type);

describe('tray menu', () => {
  it('licensed: effects, wallpapers, amount, behind windows, license line, settings, quit', () => {
    const m = buildMenu(state());
    expect(ids(m)).toEqual([
      'status',
      'separator',
      'effect-snow',
      'effect-rain',
      'effect-sakura',
      'effect-leaves',
      'effect-fireflies',
      'effect-starfall',
      'effect-off',
      'separator',
      'wallpaper',
      'intensity',
      'behind',
      'separator',
      'license',
      'separator',
      'check-updates',
      'settings',
      'quit',
    ]);
    expect(m.find((i) => i.id === 'effect-snow')!.checked).toBe(true);
    expect(m.find((i) => i.id === 'license')!.label).toBe('a@example.com · 2 of 5 computers');
    expect(m.find((i) => i.id === 'wallpaper')!.submenu).toHaveLength(5);
    expect(m.find((i) => i.id === 'quit')!.accelerator).toBe('Command+Q');
  });
  it('1-computer keys get an upgrade item; Windows uses Ctrl', () => {
    const s = state({ platform: 'windows' });
    s.license.seats = 1;
    const m = buildMenu(s);
    expect(ids(m)).toContain('upgrade');
    expect(m.find((i) => i.id === 'license')!.label).toMatch(/1 computer$/);
    expect(m.find((i) => i.id === 'settings')!.accelerator).toBe('Ctrl+,');
  });
  it('unlicensed: effects disabled; enter key, preview and buy offered', () => {
    const m = buildMenu(state({ license: { status: 'none', key: null, email: null, seats: null, used: null, checkedAt: null, message: null } }));
    expect(m.find((i) => i.id === 'effect-rain')!.enabled).toBe(false);
    expect(ids(m)).toEqual(expect.arrayContaining(['enter-key', 'preview', 'buy']));
    expect(m[0].label).toMatch(/add your key/);
  });
  it('shows update availability and progress', () => {
    expect(
      buildMenu(state({ update: { status: 'available', version: '1.2.0', notes: null, progress: null, message: null, required: false } })).find(
        (i) => i.id === 'update',
      )!.label,
    ).toBe('Update to 1.2.0…');
    expect(
      buildMenu(state({ update: { status: 'downloading', version: '1.2.0', notes: null, progress: 0.42, message: null, required: false } })).find(
        (i) => i.id === 'update',
      )!.label,
    ).toMatch(/42%/);
  });
  it('status line reflects pause, battery and preview', () => {
    expect(statusLine(state())).toBe('Snow');
    expect(statusLine(state({ paused: 'fullscreen' }))).toMatch(/full screen/);
    expect(statusLine(state({ onBattery: true }))).toMatch(/battery saver/);
    const off = state();
    off.settings.effect = 'off';
    expect(statusLine(off)).toBe('Driftsky is off');
  });
});

describe('geometry', () => {
  const display = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 805 } };
  it('derives the Dock strip and ignores side/hidden docks', () => {
    expect(floorRect(display.bounds, display.workArea)).toEqual({ x: 0, y: 830, w: 1440, h: 70 });
    expect(floorRect(display.bounds, { x: 70, y: 25, width: 1370, height: 875 })).toBeNull();
    expect(floorRect(display.bounds, { x: 0, y: 25, width: 1440, height: 873 })).toBeNull(); // 2px: hidden
  });
  it('maps windows into each display and reports the pointer locally', () => {
    const right = { bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, workArea: { x: 1440, y: 0, width: 1920, height: 1040 } };
    const wins = [
      { id: 'a', x: 100, y: 100, w: 500, h: 400 },
      { id: 'b', x: 1300, y: 200, w: 400, h: 300 }, // straddles both
      { id: 'c', x: 2000, y: 300, w: 600, h: 400 },
    ];
    const f1 = frameFor(display, wins, { x: 50, y: 60 }, false);
    expect(f1.windows.map((w) => w.id)).toEqual(['a', 'b']);
    expect(f1.pointer).toEqual({ x: 50, y: 60 });
    const f2 = frameFor(right, wins, { x: 50, y: 60 }, false);
    expect(f2.windows).toEqual([
      { id: 'b', x: -140, y: 200, w: 400, h: 300 },
      { id: 'c', x: 560, y: 300, w: 600, h: 400 },
    ]);
    expect(f2.pointer).toBeNull();
    expect(f2.floor).toEqual({ x: 0, y: 1040, w: 1920, h: 40 });
  });
  it('detects a full-screen app in front, and drops windows when behind', () => {
    const full = [{ id: 'game', x: 0, y: 0, w: 1440, h: 900 }];
    expect(isFullScreen(full[0], display.bounds)).toBe(true);
    expect(frameFor(display, full, null, false).fullscreen).toBe(true);
    expect(frameFor(display, [{ id: 'a', x: 10, y: 10, w: 300, h: 300 }, ...full], null, false).fullscreen).toBe(false);
    expect(frameFor(display, [{ id: 'a', x: 10, y: 10, w: 300, h: 300 }], null, true).windows).toEqual([]);
  });
});

describe('Updater', () => {
  const body = Buffer.from('fake installer bytes '.repeat(1000));
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  const make = (manifest: object | null, file: Buffer = body) => {
    const opened: string[] = [];
    const f = (async (url: string) => {
      if (url.includes('/api/app')) return manifest ? new Response(JSON.stringify(manifest)) : new Response('{}', { status: 404 });
      return new Response(file, { headers: { 'content-length': String(file.length) } });
    }) as unknown as typeof fetch;
    const u = new Updater(
      'http://api',
      'mac',
      '1.0.0',
      () => undefined,
      async (p) => (opened.push(p), ''),
      f,
    );
    return { u, opened };
  };
  it('finds, downloads, verifies and opens a newer version', async () => {
    const { u, opened } = make({ latest: '1.2.0', minimum: '1.0.0', url: 'https://dl/Driftsky-1.2.0.dmg', sha256: sha, notes: 'Hail.' });
    expect((await u.check(true)).status).toBe('available');
    expect(u.state.version).toBe('1.2.0');
    await u.install();
    expect(u.state.status).toBe('ready');
    expect(opened[0]).toMatch(/Driftsky-1\.2\.0\.dmg$/);
    expect(fs.readFileSync(opened[0])).toEqual(body);
  });
  it('refuses a download that does not match', async () => {
    const { u, opened } = make({ latest: '1.2.0', minimum: '1.0.0', url: 'https://dl/x.dmg', sha256: 'f'.repeat(64) });
    await u.check(true);
    await u.install();
    expect(u.state.status).toBe('error');
    expect(u.state.message).toMatch(/didn’t match/);
    expect(opened).toEqual([]);
  });
  it('is up to date, flags required updates, rejects insecure manifests', async () => {
    expect((await make({ latest: '1.0.0', minimum: '1.0.0', url: 'https://dl/x.dmg', sha256: sha }).u.check(true)).status).toBe('up-to-date');
    expect((await make(null).u.check(true)).status).toBe('up-to-date');
    expect((await make({ latest: '2.0.0', minimum: '1.5.0', url: 'https://dl/x.dmg', sha256: sha }).u.check(true)).required).toBe(true);
    expect((await make({ latest: '2.0.0', minimum: '1.0.0', url: 'http://evil/x.dmg', sha256: sha }).u.check(true)).status).toBe('error');
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
  });
});

describe('file window source', () => {
  it('reads, validates and caches the window list', () => {
    const f = path.join(tmp(), 'w.json');
    const src = fileWindowSource(f);
    expect(src.list()).toEqual([]);
    fs.writeFileSync(f, JSON.stringify([{ id: 'a', x: 1, y: 2, w: 300, h: 200 }, { x: 'bad' }, null, { id: 7, x: 0, y: 0, w: 100, h: 100 }]));
    expect(src.list()).toEqual([
      { id: 'a', x: 1, y: 2, w: 300, h: 200 },
      { id: '7', x: 0, y: 0, w: 100, h: 100 },
    ]);
    fs.writeFileSync(f, '{half written');
    expect(src.list()).toHaveLength(2); // keeps the last good list
  });
});

describe('native bindings', () => {
  /**
   * The Mac and Windows window sources call system libraries through koffi. Those libraries don't
   * exist here, so we load the modules against a stand-in library whose func() parses every
   * signature with koffi's real parser: a typo in a declaration fails this test.
   */
  async function withFakeKoffi(load: () => unknown) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const realLoad = koffi.load;
    const parsed: string[] = [];
    let n = 0;
    koffi.load = () => ({
      func: (...args: unknown[]) => {
        n++;
        if (args.length === 1) koffi.proto(String(args[0]).replace(/\b(\w+)\s*\(/, `ds_check${n}_$1(`));
        else koffi.proto(`ds_check${n}_${args[0]}`, args[1], args[2]);
        parsed.push(String(args[0]));
        return () => 0;
      },
    });
    try {
      load();
    } finally {
      koffi.load = realLoad;
    }
    return parsed;
  }
  it('Mac CoreGraphics declarations parse', async () => {
    const { macWindowSource } = await import('../src/main/windowsource/mac');
    const parsed = await withFakeKoffi(() => macWindowSource(1));
    expect(parsed.join(' ')).toMatch(/CGWindowListCopyWindowInfo/);
    expect(parsed.length).toBeGreaterThanOrEqual(9);
  });
  it('Windows user32/dwmapi declarations parse', async () => {
    const { winWindowSource } = await import('../src/main/windowsource/win');
    const parsed = await withFakeKoffi(() => winWindowSource(1, (r) => r));
    expect(parsed.join(' ')).toMatch(/EnumWindows/);
    expect(parsed).toContain('DwmGetWindowAttribute');
  });
});

describe('review and QA fixes', () => {
  it('a slow check can’t resurrect a key that was just removed, or poison a new one', async () => {
    const store = new Store(tmp());
    const srv = fakeServer();
    let delay = 0;
    const slow = (async (u: string, i: RequestInit) => {
      const d = delay;
      await new Promise((r) => setTimeout(r, d));
      return srv.f(u, i);
    }) as typeof fetch;
    const lm = new LicenseManager(store, 'http://api', 'mac', '1.0.0', () => undefined, slow, 'race-device');
    await lm.activate('DRIFT-AAAA-BBBB-CCCC-DDDD');
    delay = 200;
    const v = lm.validate();
    delay = 0;
    const r = lm.remove();
    await Promise.all([v, r]);
    expect(lm.state).toMatchObject({ status: 'none', key: null });
  });

  it('a captive portal or proxy page doesn’t turn a good key off', async () => {
    const store = new Store(tmp());
    const srv = fakeServer();
    let mode: 'ok' | 'html' | 'proxy' = 'ok';
    const f = (async (u: string, i: RequestInit) => {
      if (mode === 'html') return new Response('<html>Log in to Wi-Fi</html>', { status: 200 });
      if (mode === 'proxy') return new Response('Forbidden', { status: 403 });
      return srv.f(u, i);
    }) as typeof fetch;
    const lm = new LicenseManager(store, 'http://api', 'mac', '1.0.0', () => undefined, f, 'portal-device');
    await lm.activate('DRIFT-AAAA-BBBB-CCCC-DDDD');
    for (const m of ['html', 'proxy'] as const) {
      mode = m;
      await lm.validate();
      expect(lm.isLicensed).toBe(true);
    }
  });

  it('a check date from the future doesn’t extend the offline grace', async () => {
    const store = new Store(tmp());
    const srv = fakeServer();
    const lm = new LicenseManager(store, 'http://api', 'mac', '1.0.0', () => undefined, srv.f, 'future-device');
    await lm.activate('DRIFT-AAAA-BBBB-CCCC-DDDD');
    store.setLicense({ ...store.data.license, checkedAt: '2999-01-01T00:00:00.000Z' });
    srv.setOnline(false);
    await lm.validate();
    expect(lm.state.status).toBe('invalid');
  });

  it('store survives wrong shapes', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'driftsky.json'), '{"settings":"x","license":7,"preview":null}');
    expect(new Store(dir).data.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('updater: a newer release is downloaded fresh, a stalled download gives up, disk errors don’t crash', async () => {
    const files: Record<string, Buffer> = { '/1.1.0.dmg': Buffer.from('installer-1.1.0'), '/1.2.0.dmg': Buffer.from('installer-1.2.0') };
    let manifest: object = {};
    const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
    let stall = false;
    const f = (async (url: string, init?: RequestInit) => {
      if (url.includes('/api/app')) return new Response(JSON.stringify(manifest));
      if (stall)
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array([1, 2, 3]));
              init?.signal?.addEventListener('abort', () => c.error(new Error('aborted')));
            },
          }),
        );
      return new Response(files[new URL(url).pathname]);
    }) as unknown as typeof fetch;
    const opened: string[] = [];
    const u = new Updater(
      'http://api',
      'mac',
      '1.0.0',
      () => undefined,
      async (p) => (opened.push(fs.readFileSync(p, 'utf8')), ''),
      f,
    );
    manifest = { latest: '1.1.0', minimum: '1.0.0', url: 'https://dl/1.1.0.dmg', sha256: sha(files['/1.1.0.dmg']) };
    await u.check(true);
    await u.install();
    manifest = { latest: '1.2.0', minimum: '1.0.0', url: 'https://dl/1.2.0.dmg', sha256: sha(files['/1.2.0.dmg']) };
    expect((await u.check(true)).status).toBe('available');
    await u.install();
    expect(opened).toEqual(['installer-1.1.0', 'installer-1.2.0']);

    manifest = { latest: '1.3.0', minimum: '1.0.0', url: 'https://dl/1.3.0.dmg', sha256: 'a'.repeat(64) };
    await u.check(true);
    stall = true;
    u.stallMs = 200;
    const st = await u.install();
    expect(st.status).toBe('error');
    expect(st.message).toMatch(/stopped/);
    expect((await u.check(true)).status).toBe('available'); // not stuck in "downloading"
  });
});
