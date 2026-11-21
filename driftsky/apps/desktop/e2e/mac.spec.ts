// Real-macOS end-to-end tests: real windows from another process, the real CoreGraphics window
// list, real wallpaper, real screenshots. Skipped elsewhere. Run on a Mac (or the macOS CI job).
import { test, expect, _electron as electron, type ElectronApplication, type APIRequestContext } from '@playwright/test';
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { TMP, WEB_PORT } from '../playwright.config';

test.skip(process.platform !== 'darwin', 'macOS only');

const API = `http://localhost:${WEB_PORT}`;
const ELECTRON = path.resolve(__dirname, '../../../node_modules/.bin/electron');
const SHOTS = process.env.MAC_RESULTS || path.join(TMP, 'mac-results');
const report: Record<string, unknown> = {};

function screenshot(name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  try {
    execFileSync('/usr/sbin/screencapture', ['-x', '-t', 'png', path.join(SHOTS, `${name}.png`)], { timeout: 15_000 });
  } catch (e) {
    report[`screenshot:${name}`] = String((e as Error).message);
  }
}

/** Another app's window, driven over stdin. */
class Helper {
  proc!: ChildProcessWithoutNullStreams;
  private waiters: Array<(m: any) => void> = [];
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  pid = 0;
  async start(bounds = '300,260,760,420') {
    this.proc = spawn(ELECTRON, [path.join(__dirname, 'helper-window.cjs')], { env: { ...process.env, HELPER_BOUNDS: bounds, ELECTRON_ENABLE_LOGGING: '0' } });
    readline.createInterface({ input: this.proc.stdout }).on('line', (l) => {
      try {
        const m = JSON.parse(l);
        if (m.bounds) this.bounds = m.bounds;
        if (m.pid) this.pid = m.pid;
        this.waiters.shift()?.(m);
      } catch {
        /* electron noise */
      }
    });
    await this.next();
  }
  next() {
    return new Promise<any>((r) => this.waiters.push(r));
  }
  async send(m: object) {
    const p = this.next();
    this.proc.stdin.write(JSON.stringify(m) + '\n');
    return p;
  }
  stop() {
    this.proc?.kill();
  }
}

async function launch(dir: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: ELECTRON,
    args: [path.resolve(__dirname, '..')],
    env: {
      ...process.env,
      DRIFTSKY_TEST: '1',
      DRIFTSKY_USER_DATA: path.join(dir, 'data'),
      DRIFTSKY_API: API,
      DRIFTSKY_SITE: API,
      DRIFTSKY_DEVICE_ID: `mac-${path.basename(dir)}`,
      // no DRIFTSKY_FAKE_WINDOWS: the real CoreGraphics window list
    },
  });
}

const hook = <T>(app: ElectronApplication, fn: string, ...args: unknown[]) =>
  app.evaluate(({}, [fn, args]) => (globalThis as any).__driftsky[fn as string](...(args as unknown[])), [fn, args] as const) as Promise<T>;
const stats = async (app: ElectronApplication) => (await hook<any[]>(app, 'overlayStats'))[0];

async function buyAndActivate(app: ElectronApplication, request: APIRequestContext) {
  const start = await request.get(`${API}/api/checkout?plan=five`, { maxRedirects: 0 });
  const id = start.headers().location.split('/').pop()!;
  await request.post(`${API}/dev/checkout/${id}`, { form: { email: 'mac-ci@example.com', action: 'pay' }, maxRedirects: 0 });
  const key = (await (await request.get(`${API}/api/checkout/session?id=${id}`)).json()).key;
  const page = await (async () => {
    await expect.poll(() => app.windows().some((w) => w.url().includes('settings/index.html')), { timeout: 20_000 }).toBe(true);
    return app.windows().find((w) => w.url().includes('settings/index.html'))!;
  })();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('License key').fill(key);
  await page.getByRole('button', { name: 'Activate' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  return page;
}

test.afterAll(() => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, 'mac-e2e-report.json'), JSON.stringify(report, null, 2));
});

test('real windows: CoreGraphics sees them, snow piles on them and flies off when they move', async ({ request }) => {
  const dir = fs.mkdtempSync(path.join(TMP, 'mac-'));
  const helper = new Helper();
  await helper.start();
  const app = await launch(dir);
  try {
    expect(await hook<string>(app, 'windowSourceName')).toBe('mac');
    const page = await buyAndActivate(app, request);
    await page.close().catch(() => undefined);

    // the helper's window is in the list, at its real position; ours are not
    await expect
      .poll(async () => {
        const wins = await hook<any[]>(app, 'windows');
        return wins.some((w) => Math.abs(w.x - helper.bounds.x) <= 2 && Math.abs(w.y - helper.bounds.y) <= 2 && Math.abs(w.w - helper.bounds.width) <= 2);
      })
      .toBe(true);
    const wins = await hook<any[]>(app, 'windows');
    report.windowList = { helper: helper.bounds, list: wins.slice(0, 8) };
    const overlays = await hook<any[]>(app, 'overlays');
    for (const o of overlays) expect(wins.some((w) => w.x === o.bounds.x && w.y === o.bounds.y && w.w === o.bounds.width && w.h === o.bounds.height)).toBe(false);

    // overlay window properties that matter on a Mac
    const props = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => w.getTitle() === 'Driftsky overlay')
        .map((w) => ({ onTop: w.isAlwaysOnTop(), allSpaces: w.isVisibleOnAllWorkspaces(), hiddenInMC: w.isHiddenInMissionControl(), focusable: w.isFocusable(), bounds: w.getBounds() })),
    );
    report.overlays = props;
    for (const p of props) expect(p).toMatchObject({ onTop: true, allSpaces: true, hiddenInMC: true, focusable: false });
    const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().map((d) => ({ bounds: d.bounds, workArea: d.workArea, scale: d.scaleFactor })));
    report.displays = displays;
    for (const p of props) expect(displays.some((d) => d.bounds.width === p.bounds.width && d.bounds.height === p.bounds.height)).toBe(true);

    await hook(app, 'runMenu', 'intensity-heavy');
    await hook(app, 'runMenu', 'effect-snow');
    await expect.poll(async () => (await stats(app)).surfaces, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await stats(app)).piled, { timeout: 60_000 }).toBeGreaterThan(600);
    screenshot('1-snow-on-real-window');
    report.snowSettled = await stats(app);

    // drag the real window quickly
    const shed0 = (await stats(app)).shed;
    for (let i = 1; i <= 10; i++) await helper.send({ cmd: 'bounds', x: 300 + i * 45, y: 260 + i * 8, w: 760, h: 420 });
    screenshot('2-window-flung');
    await expect.poll(async () => (await stats(app)).shed, { timeout: 10_000 }).toBeGreaterThan(shed0 + 5);
    report.afterFling = await stats(app);

    // a real full-screen window pauses it
    await helper.send({ cmd: 'fullscreen', on: true });
    await expect.poll(async () => (await stats(app)).config.paused, { timeout: 10_000 }).toBe(true);
    screenshot('3-fullscreen-paused');
    await helper.send({ cmd: 'fullscreen', on: false });
    await expect.poll(async () => (await stats(app)).running, { timeout: 10_000 }).toBe(true);

    // frame rate and CPU with heavy snow
    // let adaptive quality settle (slow Macs thin the weather to stay smooth), then measure
    await new Promise((r) => setTimeout(r, 12_000));
    const fps: number[] = [];
    const quality: number[] = [];
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const st = await stats(app);
      fps.push(st.fps);
      quality.push(st.quality);
    }
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage, memMB: Math.round(m.memory.workingSetSize / 1024) })));
    report.performance = { fps, quality, metrics };
    const sorted = [...fps].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeGreaterThanOrEqual(45); // median
  } finally {
    await app.close();
    helper.stop();
  }
});

test('wallpaper is really set on every screen, without a permission prompt', async ({ request }) => {
  const dir = fs.mkdtempSync(path.join(TMP, 'mac-'));
  const app = await launch(dir);
  try {
    await buyAndActivate(app, request);
    const before = await app.evaluate(async () => (globalThis as any).__driftsky.getWallpapers());
    report.wallpaperBefore = before;
    const r = await hook<any>(app, 'runMenu', 'wallpaper-autumn');
    report.wallpaperResult = r;
    expect(r).toMatchObject({ ok: true });
    const after = await app.evaluate(async () => (globalThis as any).__driftsky.getWallpapers());
    report.wallpaperAfter = after;
    expect(after.length).toBeGreaterThan(0);
    for (const p of after) expect(p).toMatch(/wallpapers\/autumn\.jpg$/);
    screenshot('4-autumn-wallpaper');
    await hook(app, 'runMenu', 'wallpaper-stars');
    for (const p of await app.evaluate(async () => (globalThis as any).__driftsky.getWallpapers())) expect(p).toMatch(/stars\.jpg$/);
    screenshot('5-stars-wallpaper');
  } finally {
    await app.close();
  }
});

test('Low Power Mode and the Dock', async ({ request }) => {
  const dir = fs.mkdtempSync(path.join(TMP, 'mac-'));
  const app = await launch(dir);
  try {
    await buyAndActivate(app, request);
    await hook(app, 'runMenu', 'effect-snow');
    await expect.poll(async () => (await stats(app)).particles, { timeout: 15_000 }).toBeGreaterThan(100);
    await hook(app, 'setLowPowerMode', true);
    await expect.poll(async () => (await stats(app)).config.lowPower).toBe(true);
    expect((await hook<any[]>(app, 'menu'))[0].label).toMatch(/battery saver/);
    await hook(app, 'setLowPowerMode', false);
    // the Dock, when it sits at the bottom, is a surface
    const d = await app.evaluate(({ screen }) => {
      const p = screen.getPrimaryDisplay();
      return { bounds: p.bounds, workArea: p.workArea };
    });
    report.dock = d;
    const bottomGap = d.bounds.y + d.bounds.height - (d.workArea.y + d.workArea.height);
    if (bottomGap >= 8) await expect.poll(async () => (await stats(app)).surfaces, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  } finally {
    await app.close();
  }
});
