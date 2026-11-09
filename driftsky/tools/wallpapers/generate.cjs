// Renders the procedural wallpapers to JPEG with headless Chromium.
// Usage: node tools/wallpapers/generate.cjs [outDir]
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const out = path.resolve(process.argv[2] || path.join(__dirname, '../../assets/wallpapers'));
  fs.mkdirSync(path.join(out, 'thumbs'), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ path: path.join(__dirname, 'scenes.js') });
  const names = await page.evaluate(() => window.SCENES);
  for (const name of names) {
    for (const [file, scale, q] of [
      [`${name}.jpg`, 2, 0.88],
      [`thumbs/${name}.jpg`, 0.5, 0.82],
    ]) {
      const dataUrl = await page.evaluate(([n, s, quality]) => window.renderScene(n, s).toDataURL('image/jpeg', quality), [name, scale, q]);
      fs.writeFileSync(path.join(out, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
    }
    console.log('wrote', name);
  }
  await browser.close();
  if (errors.length) {
    console.error(errors);
    process.exit(1);
  }
})();
