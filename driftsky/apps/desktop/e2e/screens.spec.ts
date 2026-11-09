// Not a test: captures screenshots of the app for visual review (run with SCREENS=1).
import { test, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { TMP, WEB_PORT } from '../playwright.config';

const OUT = process.env.SCREENS_OUT || path.join(TMP, 'screens');
test.skip(!process.env.SCREENS, 'screenshots only on demand');

test('capture', async ({ request }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const API = `http://localhost:${WEB_PORT}`;
  const dir = fs.mkdtempSync(path.join(TMP, 'shots-'));
  const wins = path.join(dir, 'w.json');
  fs.writeFileSync(
    wins,
    JSON.stringify([
      { id: 'a', x: 360, y: 260, w: 720, h: 400 },
      { id: 'b', x: 900, y: 420, w: 420, h: 300 },
    ]),
  );
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../../../node_modules/.bin/electron'),
    args: ['--no-sandbox', path.resolve(__dirname, '..')],
    env: {
      ...process.env,
      DRIFTSKY_TEST: '1',
      DRIFTSKY_USER_DATA: path.join(dir, 'data'),
      DRIFTSKY_API: API,
      DRIFTSKY_SITE: API,
      DRIFTSKY_FAKE_WINDOWS: wins,
      DRIFTSKY_WALLPAPER_LOG: path.join(dir, 'wp.log'),
      DRIFTSKY_DEVICE_ID: 'shots',
    },
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/welcome-1.png` });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.screenshot({ path: `${OUT}/welcome-2.png` });
  const start = await request.get(`${API}/api/checkout?plan=five`, { maxRedirects: 0 });
  const id = start.headers().location.split('/').pop()!;
  await request.post(`${API}/dev/checkout/${id}`, { form: { email: 'river@example.com', action: 'pay' }, maxRedirects: 0 });
  const key = (await (await request.get(`${API}/api/checkout/session?id=${id}`)).json()).key;
  await page.getByLabel('License key').fill(key);
  await page.getByRole('button', { name: 'Activate' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/welcome-3.png` });
  await page.getByRole('button', { name: 'Done' }).click();
  for (const tab of ['Effects', 'Wallpapers', 'License', 'Settings', 'About']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/tab-${tab.toLowerCase()}.png` });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('tab', { name: 'Effects' }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/tab-effects-dark.png` });
  for (const fx of ['snow', 'leaves', 'starfall']) {
    await app.evaluate(({}, fx) => (globalThis as any).__driftsky.runMenu(`effect-${fx}`), fx);
    await page.waitForTimeout(fx === 'snow' ? 25000 : 8000);
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Driftsky overlay')!;
      return (await w.webContents.capturePage()).toPNG().toString('base64');
    });
    fs.writeFileSync(`${OUT}/overlay-${fx}.png`, Buffer.from(png, 'base64'));
  }
  await app.close();
});
