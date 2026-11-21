import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, screen } from 'electron';
import { WALLPAPERS } from '@driftsky/engine';
import { createWindowSource } from './windowsource';
import { floorRect } from './geometry';

interface Check {
  name: string;
  ok: boolean;
  detail?: unknown;
}

/**
 * `Driftsky --self-test[=report.json]`: confirms this computer can run Driftsky (native window list,
 * bundled resources, displays) without changing anything. Used by release CI on real Macs and by
 * support ("run this and send us the output"). Exit code 0 when everything passed.
 */
export async function runSelfTest(opts: { out?: string; resource: (...p: string[]) => string; platform: NodeJS.Platform; version: string }): Promise<number> {
  const checks: Check[] = [];
  const check = async (name: string, fn: () => unknown | Promise<unknown>) => {
    try {
      const detail = await fn();
      checks.push({ name, ok: true, detail });
    } catch (e) {
      checks.push({ name, ok: false, detail: (e as Error).message });
    }
  };

  await check('window list', () => {
    const src = createWindowSource({ platform: opts.platform, pid: process.pid, toDip: (r) => screen.screenToDipRect(null, r) });
    if (opts.platform !== 'linux' && src.name === 'none') throw new Error('native window list unavailable');
    const t0 = performance.now();
    const wins = src.list();
    const ms = performance.now() - t0;
    src.dispose?.();
    for (const w of wins) if (![w.x, w.y, w.w, w.h].every(Number.isFinite) || w.w <= 0 || w.h <= 0) throw new Error(`bad window ${JSON.stringify(w)}`);
    return { source: src.name, count: wins.length, ms: Math.round(ms * 100) / 100, sample: wins.slice(0, 5) };
  });

  await check('displays', () => {
    const ds = screen.getAllDisplays();
    if (!ds.length) throw new Error('no displays');
    return ds.map((d) => ({ id: d.id, bounds: d.bounds, scale: d.scaleFactor, dock: floorRect(d.bounds, d.workArea) }));
  });

  await check('wallpapers bundled', () => {
    const missing = WALLPAPERS.filter((w) => !fs.existsSync(opts.resource('wallpapers', `${w.id}.jpg`))).map((w) => w.id);
    if (missing.length) throw new Error(`missing ${missing.join(', ')}`);
    return WALLPAPERS.map((w) => w.id);
  });

  await check('tray icons bundled', () => {
    for (const f of ['trayTemplate.png', 'trayTemplate@2x.png']) if (!fs.existsSync(opts.resource('icons', f))) throw new Error(`missing ${f}`);
    return true;
  });

  await check('app files', () => {
    for (const f of ['renderer/overlay/index.html', 'renderer/settings/index.html', 'preload-overlay.cjs', 'preload-settings.cjs']) {
      if (!fs.existsSync(path.join(__dirname, f))) throw new Error(`missing ${f}`);
    }
    return true;
  });

  const report = {
    ok: checks.every((c) => c.ok),
    app: opts.version,
    electron: process.versions.electron,
    os: `${os.type()} ${os.release()}`,
    arch: process.arch,
    packaged: app.isPackaged,
    checks,
  };
  const json = JSON.stringify(report, null, 2);
  if (opts.out) fs.writeFileSync(opts.out, json);
  process.stdout.write(json + '\n');
  return report.ok ? 0 : 1;
}
