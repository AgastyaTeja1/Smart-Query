// Builds the desktop app into dist/: main + preloads with esbuild, renderers with Vite,
// and copies shared assets (wallpapers, icons) into resources/ for the app and the installer.
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.resolve(root, '../../assets');
const dist = path.join(root, 'dist');
const resources = path.join(root, 'resources');

fs.rmSync(dist, { recursive: true, force: true });
fs.rmSync(resources, { recursive: true, force: true });
fs.cpSync(path.join(assets, 'wallpapers'), path.join(resources, 'wallpapers'), { recursive: true, filter: (p) => !p.includes(`${path.sep}thumbs`) });
fs.cpSync(path.join(assets, 'icons'), path.join(resources, 'icons'), { recursive: true });

const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: 'linked', external: ['electron', 'koffi'], logLevel: 'warning' };
await esbuild({ ...common, entryPoints: [path.join(root, 'src/main/main.ts')], outfile: path.join(dist, 'main.cjs') });
// sandboxed preloads can only require('electron'): bundle everything else
await esbuild({ ...common, entryPoints: [path.join(root, 'src/preload/overlay.ts')], outfile: path.join(dist, 'preload-overlay.cjs') });
await esbuild({ ...common, entryPoints: [path.join(root, 'src/preload/settings.ts')], outfile: path.join(dist, 'preload-settings.cjs') });

const copyThumbs = {
  name: 'driftsky-settings-assets',
  writeBundle() {
    const out = path.join(dist, 'renderer/settings');
    fs.cpSync(path.join(assets, 'wallpapers/thumbs'), path.join(out, 'thumbs'), { recursive: true });
    fs.copyFileSync(path.join(assets, 'icons/icon-256.png'), path.join(out, 'icon.png'));
  },
};
await vite({
  configFile: false,
  root: path.join(root, 'src/renderer'),
  base: './',
  logLevel: 'warn',
  plugins: [react(), copyThumbs],
  css: { postcss: {} },
  build: {
    outDir: path.join(dist, 'renderer'),
    emptyOutDir: true,
    target: 'chrome130',
    rollupOptions: { input: { overlay: path.join(root, 'src/renderer/overlay/index.html'), settings: path.join(root, 'src/renderer/settings/index.html') } },
  },
});
console.log('desktop build ok →', path.relative(process.cwd(), dist));
