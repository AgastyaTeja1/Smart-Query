import { test, expect, _electron as electron, type ElectronApplication, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TMP, WEB_PORT } from '../playwright.config';

const API = `http://localhost:${WEB_PORT}`;
const APP_DIR = path.resolve(__dirname, '..');
const ELECTRON = path.resolve(__dirname, '../../../node_modules/.bin/electron');

interface Ctx {
  app: ElectronApplication;
  dir: string;
  windowsFile: string;
  wallpaperLog: string;
  openLog: string;
}

/** Launch Driftsky with a fresh (or given) profile, a fake window list and logs instead of OS side effects. */
async function launch(opts: { dir?: string; deviceId?: string; previewMs?: number } = {}): Promise<Ctx> {
  const dir = opts.dir ?? fs.mkdtempSync(path.join(TMP, 'profile-'));
  const windowsFile = path.join(dir, 'windows.json');
  if (!fs.existsSync(windowsFile)) fs.writeFileSync(windowsFile, JSON.stringify([{ id: 'editor', x: 300, y: 260, w: 760, h: 420 }]));
  const ctx = { dir, windowsFile, wallpaperLog: path.join(dir, 'wallpaper.log'), openLog: path.join(dir, 'open.log') };
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['--no-sandbox', APP_DIR],
    env: {
      ...process.env,
      DRIFTSKY_TEST: '1',
      DRIFTSKY_USER_DATA: path.join(dir, 'data'),
      DRIFTSKY_API: API,
      DRIFTSKY_SITE: API,
      DRIFTSKY_FAKE_WINDOWS: windowsFile,
      DRIFTSKY_WALLPAPER_LOG: ctx.wallpaperLog,
      DRIFTSKY_OPEN_LOG: ctx.openLog,
      DRIFTSKY_DEVICE_ID: opts.deviceId ?? `device-${path.basename(dir)}`,
      DRIFTSKY_PREVIEW_MS: String(opts.previewMs ?? 60_000),
      NODE_OPTIONS: '',
    },
  });
  return { app, ...ctx };
}

const hooks = <T>(app: ElectronApplication, fn: string, ...args: unknown[]) =>
  app.evaluate(({}, [fn, args]) => (globalThis as any).__driftsky[fn as string](...(args as unknown[])), [fn, args] as const) as Promise<T>;

async function settingsPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('settings/index.html')), { timeout: 20_000 }).toBe(true);
  const p = app.windows().find((w) => w.url().includes('settings/index.html'))!;
  await p.waitForLoadState('domcontentloaded');
  return p;
}

async function overlayStats(app: ElectronApplication) {
  const all = await hooks<Array<Record<string, any>>>(app, 'overlayStats');
  return all[0];
}

/** Buy a key through the real (mock-payment) checkout. */
async function buyKey(request: APIRequestContext, plan: 'one' | 'five', email = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`) {
  const start = await request.get(`${API}/api/checkout?plan=${plan}`, { maxRedirects: 0 });
  const id = start.headers().location.split('/').pop()!;
  await request.post(`${API}/dev/checkout/${id}`, { form: { email, action: 'pay' }, maxRedirects: 0 });
  const s = await (await request.get(`${API}/api/checkout/session?id=${id}`)).json();
  return { key: s.key as string, email };
}

const writeWindows = (ctx: Ctx, wins: object[]) => {
  const tmp = ctx.windowsFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(wins));
  fs.renameSync(tmp, ctx.windowsFile);
};

test.beforeEach(async ({ request }) => {
  await request.post(`${API}/dev/reset-limits`);
});

test('first run: onboarding, activation, choosing weather, and the overlay', async ({ request }) => {
  const ctx = await launch();
  try {
    const { key, email } = await buyKey(request, 'five');
    const page = await settingsPage(ctx.app);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // overlays: one per display, click-through, not focusable, on top
    await expect.poll(async () => (await hooks<any[]>(ctx.app, 'overlays'))[0]?.ready).toBe(true);
    const [ov] = await hooks<any[]>(ctx.app, 'overlays');
    // covers the whole display (X11 without a window manager reports 1px less; Mac/Windows are exact)
    expect(ov.bounds).toMatchObject({ x: 0, y: 0 });
    expect(ov.bounds.width).toBeGreaterThanOrEqual(1439);
    expect(ov.bounds.height).toBeGreaterThanOrEqual(899);
    expect(ov).toMatchObject({ visible: true, focusable: false, alwaysOnTop: true });
    // nothing falls before a key
    expect((await overlayStats(ctx.app)).running).toBe(false);
    expect((await hooks<any[]>(ctx.app, 'menu'))[0].label).toMatch(/add your key/);

    await expect(page.getByRole('heading', { name: 'Weather for your desktop.' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('License key').fill('not a key');
    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByRole('alert')).toHaveText(/doesn’t look like a Driftsky key/);
    await page.getByLabel('License key').fill('DRIFT-0000-0000-0000-0000');
    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByRole('alert')).toHaveText(/couldn’t find that key/);
    // paste it the sloppy way people do
    await page.getByLabel('License key').fill(`  ${key.toLowerCase()}  `);
    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByRole('heading', { name: 'Pick the weather' })).toBeVisible();
    await page.locator('.effect-tile[data-effect=rain]').click();
    await expect(page.locator('.effect-tile[data-effect=rain]')).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { name: 'Effects' })).toBeVisible();

    // the overlay is now raining on the window from the window list
    await expect.poll(async () => (await overlayStats(ctx.app)).effect).toBe('rain');
    await expect.poll(async () => (await overlayStats(ctx.app)).splashes, { timeout: 15_000 }).toBeGreaterThan(20);
    const st = await overlayStats(ctx.app);
    expect(st.running).toBe(true);
    expect(st.surfaces).toBeGreaterThanOrEqual(2); // the window + bottom of the screen
    expect(st.worldFrames).toBeGreaterThan(10);

    const menu = await hooks<any[]>(ctx.app, 'menu');
    expect(menu[0].label).toBe('Rain');
    // long addresses are shortened so the menu stays narrow
    const label = menu.find((i) => i.id === 'license').label as string;
    expect(label).toMatch(/ · 1 of 5 computers$/);
    expect(email.startsWith(label.split(' · ')[0].replace('…', ''))).toBe(true);
    expect(label.length).toBeLessThanOrEqual(32 + ' · 1 of 5 computers'.length);
    expect(errors).toEqual([]);
  } finally {
    await ctx.app.close();
  }
});

test('snow piles on windows and flies off when a window is dragged', async ({ request }) => {
  const ctx = await launch();
  try {
    const { key } = await buyKey(request, 'one');
    const page = await settingsPage(ctx.app);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('License key').fill(key);
    await page.getByRole('button', { name: 'Activate' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await hooks(ctx.app, 'runMenu', 'intensity-heavy');
    await hooks(ctx.app, 'runMenu', 'effect-snow');
    await expect.poll(async () => (await overlayStats(ctx.app)).effect).toBe('snow');
    await expect.poll(async () => (await overlayStats(ctx.app)).piled, { timeout: 40_000 }).toBeGreaterThan(400);
    const shed0 = (await overlayStats(ctx.app)).shed;
    // drag the window quickly across the screen
    for (let i = 1; i <= 12; i++) {
      writeWindows(ctx, [{ id: 'editor', x: 300 + i * 40, y: 260 - i * 6, w: 760, h: 420 }]);
      await new Promise((r) => setTimeout(r, 30));
    }
    await expect.poll(async () => (await overlayStats(ctx.app)).shed, { timeout: 10_000 }).toBeGreaterThan(shed0 + 5);
    // closing the window drops what's left
    writeWindows(ctx, []);
    await expect.poll(async () => (await overlayStats(ctx.app)).surfaces).toBe(1);
  } finally {
    await ctx.app.close();
  }
});

test('battery saver, pauses and full-screen apps', async ({ request }) => {
  const ctx = await launch();
  try {
    const { key } = await buyKey(request, 'one');
    const page = await settingsPage(ctx.app);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('License key').fill(key);
    await page.getByRole('button', { name: 'Activate' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await hooks(ctx.app, 'runMenu', 'effect-snow');
    await expect.poll(async () => (await overlayStats(ctx.app)).particles, { timeout: 15_000 }).toBeGreaterThan(150);
    await hooks(ctx.app, 'setBattery', true);
    await expect.poll(async () => (await overlayStats(ctx.app)).config.lowPower).toBe(true);
    await expect.poll(async () => (await overlayStats(ctx.app)).particles).toBeLessThan(150);
    expect((await hooks<any[]>(ctx.app, 'menu'))[0].label).toMatch(/battery saver/);
    // turning the setting off restores full weather even on battery
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('switch', { name: /Battery saver/ }).click();
    await expect.poll(async () => (await overlayStats(ctx.app)).config.lowPower).toBe(false);
    await hooks(ctx.app, 'setBattery', false);

    await hooks(ctx.app, 'setPaused', 'locked');
    await expect.poll(async () => (await overlayStats(ctx.app)).running).toBe(false);
    await hooks(ctx.app, 'setPaused', null);
    await expect.poll(async () => (await overlayStats(ctx.app)).running).toBe(true);
    // locked, then asleep, then awake: still locked until unlocked
    for (const ev of ['lock-screen', 'suspend', 'resume']) await hooks(ctx.app, 'power', ev);
    expect((await hooks<any>(ctx.app, 'state')).paused).toBe('locked');
    await hooks(ctx.app, 'power', 'unlock-screen');
    await expect.poll(async () => (await overlayStats(ctx.app)).running).toBe(true);

    writeWindows(ctx, [{ id: 'video', x: 0, y: 0, w: 1440, h: 900 }]);
    await expect.poll(async () => (await overlayStats(ctx.app)).config.paused).toBe(true);
    await expect.poll(async () => (await hooks<any[]>(ctx.app, 'menu'))[0].label).toMatch(/paused for full screen/);
    await expect.poll(async () => (await overlayStats(ctx.app)).running).toBe(false);
    writeWindows(ctx, [{ id: 'editor', x: 300, y: 260, w: 760, h: 420 }]);
    await expect.poll(async () => (await overlayStats(ctx.app)).running).toBe(true);
    // the user can opt out of pausing for full screen
    await page.getByRole('switch', { name: /Pause for full-screen apps/ }).click();
    writeWindows(ctx, [{ id: 'video', x: 0, y: 0, w: 1440, h: 900 }]);
    await page.waitForTimeout(500);
    expect((await overlayStats(ctx.app)).running).toBe(true);
  } finally {
    await ctx.app.close();
  }
});

test('wallpapers, effects menu, amount, behind windows, and settings survive a restart', async ({ request }) => {
  const ctx = await launch();
  const { key } = await buyKey(request, 'one');
  try {
    const page = await settingsPage(ctx.app);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('License key').fill(key);
    await page.getByRole('button', { name: 'Activate' }).click();
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('tab', { name: 'Wallpapers' }).click();
    await page.locator('.wp[data-wallpaper=autumn]').click();
    await expect(page.getByRole('status')).toHaveText('Autumn is now your wallpaper.');
    const logged = fs
      .readFileSync(ctx.wallpaperLog, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(logged.at(-1).id).toBe('autumn');
    expect(fs.existsSync(logged.at(-1).path)).toBe(true); // copied out where the OS can read it
    await hooks(ctx.app, 'runMenu', 'wallpaper-stars');
    expect(fs.readFileSync(ctx.wallpaperLog, 'utf8')).toContain('"stars"');
    await expect(page.locator('.wp[data-wallpaper=stars]')).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('tab', { name: 'Effects' }).click();
    await page.locator('.effect-tile[data-effect=fireflies]').click();
    await expect.poll(async () => (await overlayStats(ctx.app)).effect).toBe('fireflies');
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect.poll(async () => (await overlayStats(ctx.app)).config.intensity).toBe(0.5);
    await page.getByRole('switch', { name: /Weather/ }).click();
    await expect.poll(async () => (await overlayStats(ctx.app)).running).toBe(false);
    expect((await hooks<any[]>(ctx.app, 'menu'))[0].label).toBe('Driftsky is off');
    await page.getByRole('switch', { name: /Weather/ }).click();
    await expect.poll(async () => (await overlayStats(ctx.app)).effect).toBe('fireflies');

    if ((await hooks<any>(ctx.app, 'state')).canGoBehind) {
      await page.getByRole('switch', { name: /Behind windows/ }).click();
      await expect.poll(async () => (await hooks<any[]>(ctx.app, 'overlays'))[0]?.alwaysOnTop).toBe(false);
      await expect.poll(async () => (await overlayStats(ctx.app))?.surfaces).toBe(1); // only the bottom of the screen
      await page.getByRole('switch', { name: /Behind windows/ }).click();
      await expect.poll(async () => (await hooks<any[]>(ctx.app, 'overlays'))[0]?.alwaysOnTop).toBe(true);
    } else {
      // only offered where the OS has a real desktop window level (macOS)
      await expect(page.getByRole('switch', { name: /Behind windows/ })).toHaveCount(0);
      expect((await hooks<any[]>(ctx.app, 'menu')).map((i) => i.id)).not.toContain('behind');
      expect(await page.evaluate(() => (window as any).driftsky.setSettings({ behindWindows: true }))).toMatchObject({ ok: false });
    }

    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('switch', { name: /Open at login/ }).click();
    await expect(page.getByRole('switch', { name: /Open at login/ })).toHaveAttribute('aria-checked', 'false');
  } finally {
    await ctx.app.close();
  }
  // restart with the same profile: everything is remembered, no onboarding again
  const again = await launch({ dir: ctx.dir });
  try {
    await expect
      .poll(async () => (await hooks<any>(again.app, 'state')).settings)
      .toMatchObject({ effect: 'fireflies', wallpaper: 'stars', intensity: 0.5, openAtLogin: false, onboarded: true });
    expect((await hooks<any>(again.app, 'state')).license.status).toBe('active');
    await expect.poll(async () => (await overlayStats(again.app))?.effect).toBe('fireflies');
    await again.app.waitForEvent('window', { timeout: 3000 }).catch(() => null);
    expect(await hooks<boolean>(again.app, 'settingsOpen')).toBe(false); // launches quietly into the menu bar
  } finally {
    await again.app.close();
  }
});

test('license tab: details, seat limits, removing and moving a key', async ({ request }) => {
  const { key, email } = await buyKey(request, 'one');
  // another computer already uses this 1-computer key
  const other = crypto.createHash('sha256').update('other-computer').digest('hex');
  expect((await request.post(`${API}/api/license/activate`, { data: { key, device: other } })).status()).toBe(200);

  const ctx = await launch();
  try {
    const page = await settingsPage(ctx.app);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('License key').fill(key);
    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByRole('alert')).toHaveText(/already on as many computers/);
    // free it on the other computer, then it works here
    await request.post(`${API}/api/license/deactivate`, { data: { key, device: other } });
    await page.getByRole('button', { name: 'Activate' }).click();
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('tab', { name: 'License' }).click();
    await expect(page.getByTestId('license-email')).toHaveText(email);
    await expect(page.getByTestId('license-seats')).toHaveText('Covers 1 computer');
    await expect(page.getByTestId('license-key')).toContainText('••••');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.getByTestId('license-key')).toHaveText(key);
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('status')).toHaveText('Key copied.');
    expect(await ctx.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(key);
    await expect(page.getByRole('button', { name: 'Upgrade to 5 computers' })).toBeVisible();

    await page.getByRole('button', { name: 'Remove key…' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(/removed from this computer/);
    await expect(page.getByLabel('License key')).toBeVisible();
    await expect.poll(async () => (await overlayStats(ctx.app)).running).toBe(false);
    // the seat is free again on the server
    expect((await request.post(`${API}/api/license/activate`, { data: { key, device: other } })).status()).toBe(200);
  } finally {
    await ctx.app.close();
  }
});

test('a key removed or revoked elsewhere stops the weather and says why', async ({ request }) => {
  const { key } = await buyKey(request, 'five');
  const ctx = await launch({ deviceId: 'revoke-test-device' });
  try {
    const page = await settingsPage(ctx.app);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('License key').fill(key);
    await page.getByRole('button', { name: 'Activate' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect.poll(async () => (await overlayStats(ctx.app)).running).toBe(true);
    const device = crypto.createHash('sha256').update('driftsky:revoke-test-device').digest('hex');
    await request.post(`${API}/api/license/deactivate`, { data: { key, device } });
    await hooks(ctx.app, 'validate');
    await expect.poll(async () => (await overlayStats(ctx.app)).running).toBe(false);
    // the License tab opens by itself and explains
    await expect(page.getByRole('heading', { name: 'License' })).toBeVisible();
    await expect(page.locator('.notice.bad')).toHaveText(/removed from the key/);
    expect((await hooks<any[]>(ctx.app, 'menu'))[0].label).toMatch(/needs your key/);
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByRole('alert')).toHaveText(/removed from the key/);
    await page.getByRole('button', { name: 'Add this computer again' }).click();
    await expect.poll(async () => (await overlayStats(ctx.app)).running).toBe(true);
    await expect(page.getByTestId('license-email')).toBeVisible();
  } finally {
    await ctx.app.close();
  }
});

test('try it for a minute, once', async () => {
  const ctx = await launch({ previewMs: 2500 });
  try {
    const page = await settingsPage(ctx.app);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Try it for a minute' }).click();
    await expect(page.getByRole('heading', { name: 'Pick the weather' })).toBeVisible();
    await expect.poll(async () => (await overlayStats(ctx.app)).running).toBe(true);
    expect((await hooks<any[]>(ctx.app, 'menu'))[0].label).toMatch(/preview/);
    await page.getByRole('button', { name: 'Done' }).click();
    // the preview ends by itself and points to the License tab
    await expect.poll(async () => (await overlayStats(ctx.app)).running, { timeout: 10_000 }).toBe(false);
    await expect(page.getByRole('heading', { name: 'License' })).toBeVisible();
    const menu = await hooks<any[]>(ctx.app, 'menu');
    expect(menu.map((i) => i.id)).not.toContain('preview');
    await expect(hooks(ctx.app, 'runMenu', 'effect-snow')).rejects.toThrow(/disabled/);
  } finally {
    await ctx.app.close();
  }
});

test('updates: up to date, then a verified download of a new version, and a tampered one', async ({ request }) => {
  const releases = path.join(TMP, 'releases.json');
  fs.rmSync(releases, { force: true });
  const ctx = await launch();
  try {
    const page = await settingsPage(ctx.app);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page.getByRole('tab', { name: 'About' }).click();
    await expect(page.getByTestId('version')).toHaveText('Version 1.0.0');
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.locator('.update-box')).toContainText('Driftsky is up to date.');

    const installer = Buffer.from('pretend this is a disk image '.repeat(5000));
    fs.writeFileSync(path.join(TMP, 'files', 'Driftsky-1.1.0.dmg'), installer);
    const sha = crypto.createHash('sha256').update(installer).digest('hex');
    const write = (s: string) =>
      fs.writeFileSync(
        releases,
        JSON.stringify({
          mac: { latest: '1.1.0', url: `${API}/files/Driftsky-1.1.0.dmg`, sha256: s, notes: 'Hail is here.' },
          windows: { latest: '1.1.0', url: `${API}/files/Driftsky-1.1.0.dmg`, sha256: s },
        }),
      );

    write('0'.repeat(64)); // wrong checksum first
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.locator('.update-box')).toContainText('Version 1.1.0 is available.');
    expect((await hooks<any[]>(ctx.app, 'menu')).find((i) => i.id === 'update').label).toBe('Update to 1.1.0…');
    await page.getByRole('button', { name: 'Download and install' }).click();
    await expect(page.locator('.update-box')).toContainText('didn’t match the release');
    expect(fs.existsSync(ctx.openLog)).toBe(false);

    write(sha);
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await page.getByRole('button', { name: 'Download and install' }).click();
    await expect.poll(() => (fs.existsSync(ctx.openLog) ? fs.readFileSync(ctx.openLog, 'utf8') : '')).toMatch(/Driftsky-1\.1\.0\.dmg/);
    const opened = fs.readFileSync(ctx.openLog, 'utf8').trim();
    expect(fs.readFileSync(opened)).toEqual(installer);
  } finally {
    await ctx.app.close();
    fs.rmSync(releases, { force: true });
  }
});

test('the settings window is locked down', async () => {
  const ctx = await launch();
  try {
    const page = await settingsPage(ctx.app);
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
    expect(await page.evaluate(() => typeof (window as any).process)).toBe('undefined');
    expect(await page.evaluate(() => Object.keys((window as any).driftsky).sort())).toEqual(
      [
        'activate',
        'buy',
        'checkUpdates',
        'copyKey',
        'recheck',
        'finishOnboarding',
        'getState',
        'installUpdate',
        'onNavigate',
        'onState',
        'openLink',
        'preview',
        'removeKey',
        'setEffect',
        'setSettings',
        'setWallpaper',
        'upgrade',
      ].sort(),
    );
    // bad input over IPC is rejected, not trusted
    expect(await page.evaluate(() => (window as any).driftsky.setEffect('hail'))).toMatchObject({ ok: false });
    expect(await page.evaluate(() => (window as any).driftsky.setSettings({ intensity: 50 }))).toMatchObject({ ok: false });
    expect(await page.evaluate(() => (window as any).driftsky.setSettings({ __proto__: { x: 1 }, evil: true }))).toMatchObject({ ok: false });
    expect(await page.evaluate(() => (window as any).driftsky.setWallpaper('../../../etc/passwd'))).toMatchObject({ ok: false });
    // can't open other windows or navigate away
    const before = ctx.app.windows().length;
    await page.evaluate(() => window.open('https://example.com'));
    await page.waitForTimeout(500);
    expect(ctx.app.windows().length).toBe(before);
    await page.evaluate(() => (location.href = 'https://example.com'));
    await page.waitForTimeout(500);
    expect(page.url()).toContain('settings/index.html');
  } finally {
    await ctx.app.close();
  }
});
