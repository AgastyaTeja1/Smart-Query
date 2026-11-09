import fs from 'node:fs';
import { z } from 'zod';

const release = z.object({
  latest: z.string().regex(/^\d+\.\d+\.\d+$/),
  minimum: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
  /** The app update itself (dmg / exe). */
  url: z.string().url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** What the website's Download button gives you (defaults to url). */
  download: z.string().url().optional(),
  notes: z.string().optional(),
});
const file = z.object({ mac: release.optional(), windows: release.optional() });
export type Release = z.infer<typeof release>;
export type Releases = z.infer<typeof file>;

/** Reads releases.json on demand (cached by mtime) so a new release needs no restart. */
export class ReleaseStore {
  private cache: { mtime: number; data: Releases } | null = null;
  constructor(private path: string) {}

  get(): Releases {
    try {
      const st = fs.statSync(this.path);
      if (this.cache && this.cache.mtime === st.mtimeMs) return this.cache.data;
      const data = file.parse(JSON.parse(fs.readFileSync(this.path, 'utf8')));
      this.cache = { mtime: st.mtimeMs, data };
      return data;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[releases] could not read', this.path, (e as Error).message);
      return {};
    }
  }

  for(platform: 'mac' | 'windows'): Release | undefined {
    return this.get()[platform];
  }
}

/** Compare dotted versions numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}
