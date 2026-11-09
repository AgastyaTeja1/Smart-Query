import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const assets = path.resolve(__dirname, '../../assets');

/** Serve the shared /assets folder (wallpapers, icons) in dev and copy it into the build. */
function sharedAssets(): Plugin {
  const map: Record<string, string> = { '/wallpapers/': 'wallpapers', '/icons/': 'icons' };
  return {
    name: 'driftsky-shared-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        const prefix = Object.keys(map).find((p) => url.startsWith(p));
        if (!prefix) return next();
        const file = path.join(assets, map[prefix], decodeURIComponent(url.slice(prefix.length)));
        if (!file.startsWith(assets + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        res.setHeader('Content-Type', file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle(opts) {
      const out = opts.dir!;
      for (const dir of Object.values(map)) fs.cpSync(path.join(assets, dir), path.join(out, dir), { recursive: true });
      fs.copyFileSync(path.join(assets, 'icons/icon.svg'), path.join(out, 'icon.svg'));
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), sharedAssets()],
  build: { outDir: 'dist/client', emptyOutDir: true, sourcemap: false },
  css: { postcss: {} },
});
