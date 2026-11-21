import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const RELEASES = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp/releases.json');

/** Fail any test that logs a console error or throws. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|ERR_ABORTED|status of 50[03]/.test(m.text()) && errors.push(m.text()));
  return errors;
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 700;

async function dismissCookies(page: Page) {
  const ok = page.getByRole('dialog', { name: 'Cookie choice' }).getByRole('button', { name: 'OK' });
  if (await ok.isVisible().catch(() => false)) await ok.click();
}

async function sceneStats(page: Page, id: string) {
  return page.evaluate((id) => {
    const s = window.__scenes?.[id];
    if (!s) return null;
    const e = s.engine as unknown as { stats(): Record<string, number>; active: { piles?: Map<string, { volume(): number }> } };
    const st = e.stats();
    const winPile = e.active?.piles ? [...e.active.piles.entries()].filter(([k]) => k.startsWith('w:')).reduce((a, [, p]) => a + p.volume(), 0) : 0;
    return { ...st, winPile } as Record<string, number>;
  }, id);
}

test.beforeEach(async ({ request, page }, info) => {
  await request.post('/dev/reset-limits');
  // the cookie banner slides in after a few seconds; most tests act as a returning visitor
  if (!/cookie/i.test(info.title)) await page.addInitScript(() => localStorage.setItem('ds-consent', 'no'));
});

test('home page renders every section with no errors and no sideways scroll', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle(/Driftsky/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Weather for\s*your desktop\./);
  for (const name of [/Throw a window/, /Six kinds of weather/, /Wallpapers to match/, /Ready in a minute/, /Pay once/, /Good to know/]) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.locator('.effect-card')).toHaveCount(6);
  await expect(page.locator('.wallpapers figure')).toHaveCount(5);
  await expect(page.locator('.plan')).toHaveCount(2);
  await expect(page.locator('.faq-item')).toHaveCount(9);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('header navigation scrolls to each section', async ({ page }) => {
  test.skip(isMobile(page), 'the section links are hidden on phones, as on the original');
  await page.goto('/');
  await dismissCookies(page);
  for (const [label, id] of [
    ['Effects', 'effects'],
    ['Wallpapers', 'wallpapers'],
    ['Pricing', 'pricing'],
    ['FAQ', 'faq'],
  ]) {
    await page.locator('.main-nav').getByRole('link', { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(page.locator(`#${id}`)).toBeInViewport({ ratio: 0.1 });
  }
  await page.locator('.price-pill').click();
  await expect(page.locator('#pricing')).toBeInViewport({ ratio: 0.1 });
});

test('the hero demo has snow piled up, and dragging the window throws it off', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await dismissCookies(page);
  await page.getByRole('button', { name: /See how it works/ }).click();
  await expect(page.locator('[data-testid=hero] .scene-fx')).toHaveClass(/ready/, { timeout: 20_000 });
  const before = (await sceneStats(page, 'hero'))!;
  expect(before.effect).toBe('snow');
  expect(before.winPile).toBeGreaterThan(200);
  expect(before.particles).toBeGreaterThan(30);
  const hint = page.locator('.drag-hint');
  await expect(hint).not.toHaveClass(/gone/);

  // grab the window and fling it sideways
  const win = page.locator('[data-testid=hero] [data-win=notes]');
  const box = (await win.boundingBox())!;
  const sx = box.x + box.width / 2;
  const sy = box.y + 12;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(sx + (i % 2 ? 1 : -1) * box.width * 0.35, sy + 20, { steps: 2 });
  }
  await page.mouse.up();
  await expect(hint).toHaveClass(/gone/);
  await expect.poll(async () => (await sceneStats(page, 'hero'))!.shed, { timeout: 5000 }).toBeGreaterThan(5);
  const after = (await sceneStats(page, 'hero'))!;
  expect(after.winPile).toBeLessThan(before.winPile * 0.5);
  // the window really moved
  const moved = (await win.boundingBox())!;
  expect(Math.abs(moved.y - box.y)).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test('every effect card runs its own weather', async ({ page }) => {
  await page.goto('/#effects');
  await dismissCookies(page);
  for (const id of ['snow', 'rain', 'sakura', 'leaves', 'fireflies', 'starfall']) {
    const card = page.locator(`[data-effect=${id}]`);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.scene-fx')).toHaveClass(/ready/, { timeout: 20_000 });
    await expect.poll(async () => (await sceneStats(page, `effect-${id}`))?.effect).toBe(id);
    await expect.poll(async () => (await sceneStats(page, `effect-${id}`))!.particles).toBeGreaterThan(0);
  }
  await expect.poll(async () => (await sceneStats(page, 'effect-rain'))!.splashes).toBeGreaterThan(10);
  await page.locator('[data-effect=starfall]').scrollIntoViewIfNeeded();
  await expect.poll(async () => (await sceneStats(page, 'effect-starfall'))!.bursts, { timeout: 15_000 }).toBeGreaterThan(0);
});

test('fireflies come to a resting pointer; leaves fly from a sweeping one', async ({ page }) => {
  test.skip(isMobile(page), 'needs a mouse');
  await page.goto('/#effects');
  await dismissCookies(page);
  const ff = page.locator('[data-testid=effect-fireflies]');
  await ff.scrollIntoViewIfNeeded();
  await expect(ff.locator('.scene-fx')).toHaveClass(/ready/);
  const fb = (await ff.boundingBox())!;
  await page.mouse.move(fb.x + fb.width * 0.8, fb.y + fb.height * 0.3);
  await page.mouse.move(fb.x + fb.width * 0.8 + 1, fb.y + fb.height * 0.3 + 1);
  await expect.poll(async () => (await sceneStats(page, 'effect-fireflies'))!.gathered, { timeout: 15_000 }).toBeGreaterThan(5);

  const lv = page.locator('[data-testid=effect-leaves]');
  await lv.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await sceneStats(page, 'effect-leaves'))!.resting, { timeout: 15_000 }).toBeGreaterThan(3);
  const win = (await lv.locator('[data-win=w]').boundingBox())!;
  for (let pass = 0; pass < 3; pass++) {
    await page.mouse.move(win.x - 20, win.y - 3);
    await page.mouse.move(win.x + win.width + 20, win.y - 3, { steps: 6 });
  }
  await expect.poll(async () => (await sceneStats(page, 'effect-leaves'))!.shed, { timeout: 5000 }).toBeGreaterThan(0);
});

test('FAQ answers open and close independently, with accessible state', async ({ page }) => {
  await page.goto('/#faq');
  const q1 = page.getByRole('button', { name: 'What’s included?' });
  const q2 = page.getByRole('button', { name: 'How do I unlock it?' });
  await expect(q1).toHaveAttribute('aria-expanded', 'false');
  await q1.click();
  await expect(q1).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(/All of it: the six effects/)).toBeVisible();
  await q2.click();
  // like <details>: both stay open
  await expect(q1).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(/we email you a license key/)).toBeVisible();
  await q1.click();
  await expect(page.getByText(/All of it: the six effects/)).toBeHidden();
  await expect(page.getByText(/we email you a license key/)).toBeVisible();
  // keyboard
  await q1.focus();
  await page.keyboard.press('Enter');
  await expect(q1).toHaveAttribute('aria-expanded', 'true');
});

test('wallpaper preview opens full size and closes with Escape', async ({ page }) => {
  await page.goto('/#wallpapers');
  await dismissCookies(page);
  const thumb = page.getByRole('button', { name: 'Preview the Autumn wallpaper' });
  await thumb.click();
  const dialog = page.getByRole('dialog', { name: 'Autumn wallpaper' });
  await expect(dialog).toBeVisible();
  const img = dialog.getByRole('img');
  await expect(img).toHaveAttribute('src', '/wallpapers/autumn.jpg');
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(2880);
  // focus can't wander behind the dialog
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(thumb).toBeFocused();
  // thumbnails keep the 16:10 shape
  const b = (await thumb.boundingBox())!;
  expect(b.width / b.height).toBeGreaterThan(1.5);
});

test('cookie choice is remembered and can be changed', async ({ page }) => {
  await page.goto('/');
  const banner = page.getByRole('dialog', { name: 'Cookie choice' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'No thanks' }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(banner).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('ds-consent'))).toBe('no');
  await page.getByRole('button', { name: 'Cookie settings' }).click();
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button', { name: 'OK' })).toBeFocused();
  await banner.getByRole('button', { name: 'OK' }).click();
  expect(await page.evaluate(() => localStorage.getItem('ds-consent'))).toBe('yes');
});

test('buying a key end to end: checkout → thank-you page → email → activation', async ({ page, request }) => {
  const email = `buyer-${Date.now()}@example.com`;
  await page.goto('/#pricing');
  await dismissCookies(page);
  await page.getByTestId('buy-five').click();
  await expect(page).toHaveURL(/\/dev\/checkout\/cs_mock_/);
  await expect(page.getByRole('heading', { name: /5 computers/ })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Pay $15' }).click();
  await expect(page).toHaveURL(/\/thanks\?session_id=cs_mock_/);
  await expect(page.getByRole('heading', { name: /You’re all set/ })).toBeVisible();
  const key = (await page.getByTestId('license-key').locator('code').textContent())!.trim();
  expect(key).toMatch(/^DRIFT-[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(/up to 5 computers/)).toBeVisible();

  const mail = await (await request.get(`/dev/outbox?to=${encodeURIComponent(email)}`)).json();
  expect(mail).toHaveLength(1);
  expect(mail[0].text).toContain(key);

  // the desktop app's calls
  const device = crypto.createHash('sha256').update(email).digest('hex');
  const act = await request.post('/api/license/activate', { data: { key: key.toLowerCase().replace(/-/g, ' '), device, platform: 'mac', name: 'Test Mac' } });
  expect(act.status()).toBe(200);
  expect(await act.json()).toMatchObject({ ok: true, key, license: { email, seats: 5, used: 1 } });
  const val = await request.post('/api/license/validate', { data: { key, device } });
  expect((await val.json()).valid).toBe(true);
});

test('cheaper plan and leaving checkout without paying', async ({ page, request }) => {
  const email = `leaver-${Date.now()}@example.com`;
  await page.goto('/#pricing');
  await dismissCookies(page);
  await page.getByTestId('buy-one').click();
  await expect(page.getByRole('button', { name: 'Pay $9' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Send me offers from Driftsky').check();
  await page.getByRole('button', { name: 'Leave without paying' }).click();
  await expect(page).toHaveURL(/\/#pricing$/);
  await expect(page.locator('#pricing')).toBeInViewport({ ratio: 0.1 });
  const mail = await (await request.get(`/dev/outbox?to=${encodeURIComponent(email)}`)).json();
  expect(mail).toHaveLength(1);
  expect(mail[0].subject).toMatch(/20% off/);
});

test('thank-you page handles a missing or unknown order', async ({ page }) => {
  await page.goto('/thanks');
  await expect(page.getByRole('heading', { name: /couldn’t find that order/ })).toBeVisible();
  await page.goto('/thanks?session_id=cs_mock_unknown123');
  await expect(page.getByRole('heading', { name: /couldn’t find that order/ })).toBeVisible();
  await page.getByRole('link', { name: 'We can send it again' }).click();
  await expect(page).toHaveURL(/\/lost-key$/);
});

test('lost key form', async ({ page }) => {
  await page.goto('/lost-key');
  await dismissCookies(page);
  await page.getByPlaceholder('you@example.com').fill('someone@example.com');
  await page.getByRole('button', { name: 'Send my key' }).click();
  await expect(page.getByRole('status')).toHaveText(/If that email bought Driftsky/);
});

test('download buttons: friendly page before a release, redirect after', async ({ page, request }) => {
  fs.rmSync(RELEASES, { force: true });
  await page.goto('/');
  await dismissCookies(page);
  await page.getByTestId('dl-mac').click();
  await expect(page.getByRole('heading', { name: 'Almost ready' })).toBeVisible();
  const sha = 'b'.repeat(64);
  fs.writeFileSync(
    RELEASES,
    JSON.stringify({
      mac: { latest: '1.0.0', url: 'https://downloads.example.com/Driftsky-1.0.0.dmg', sha256: sha },
      windows: { latest: '1.0.0', url: 'https://downloads.example.com/Driftsky-Setup-1.0.0.exe', sha256: sha },
    }),
  );
  const r = await request.get('/download', { maxRedirects: 0 });
  expect(r.status()).toBe(302);
  expect(r.headers().location).toBe('https://downloads.example.com/Driftsky-1.0.0.dmg');
  // Mac-only launch: no Windows button anywhere
  await page.goto('/');
  await expect(page.getByTestId('dl-windows')).toHaveCount(0);
  await expect(page.getByText(/Windows/)).toHaveCount(0);
  expect((await (await request.get('/api/app?platform=mac')).json()).latest).toBe('1.0.0');
  fs.rmSync(RELEASES, { force: true });
});

test('legal pages, client navigation, and a real 404', async ({ page, request }) => {
  await page.goto('/');
  await dismissCookies(page);
  await page.locator('.site-footer').getByRole('link', { name: 'Terms' }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Terms' })).toBeVisible();
  await expect(page).toHaveTitle(/Terms · Driftsky/);
  await page.getByRole('link', { name: 'refund policy' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Refund policy' })).toBeVisible();
  await page.locator('.site-footer').getByRole('link', { name: 'Privacy' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Refund policy' })).toBeVisible();
  // header logo returns home at the top
  await page.locator('.site-header .brand').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Weather for/);

  const missing = await request.get('/this-does-not-exist');
  expect(missing.status()).toBe(404);
  await page.goto('/this-does-not-exist');
  await expect(page.getByRole('heading', { name: /Nothing here/ })).toBeVisible();
});

test('production security headers are present', async ({ request }) => {
  const r = await request.get('/');
  const h = r.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['strict-transport-security']).toBeTruthy();
  expect(h['x-content-type-options']).toBe('nosniff');
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('still shows a settled scene, without animating', async ({ page }) => {
    await page.goto('/');
    await dismissCookies(page);
    await page.locator('#demo').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-testid=hero] .scene-fx')).toHaveClass(/ready/, { timeout: 20_000 });
    const a = (await sceneStats(page, 'hero'))!;
    await page.waitForTimeout(800);
    const b = (await sceneStats(page, 'hero'))!;
    expect(a.winPile).toBeGreaterThan(100);
    expect(b.landed).toBe(a.landed); // not running
  });
});
