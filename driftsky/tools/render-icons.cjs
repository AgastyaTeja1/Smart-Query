// Renders the SVG icons to PNGs at the sizes the app, installer and website need.
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
(async () => {
  const dir = path.join(__dirname, '../assets/icons');
  const b = await chromium.launch();
  const p = await b.newPage();
  const shot = async (svg, size, out, invert = false) => {
    const src = fs.readFileSync(path.join(dir, svg), 'utf8');
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;${invert ? 'filter:invert(1)' : ''}">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`);
    await p.screenshot({ path: path.join(dir, out), omitBackground: true });
  };
  for (const s of [16, 32, 64, 128, 180, 256, 512, 1024]) await shot('icon.svg', s, `icon-${s}.png`);
  await shot('tray.svg', 16, 'trayTemplate.png');
  await shot('tray.svg', 32, 'trayTemplate@2x.png');
  await shot('tray.svg', 16, 'tray-light.png', true);
  await shot('tray.svg', 32, 'tray-light@2x.png', true);
  await b.close();
  console.log('icons ok');
})();
