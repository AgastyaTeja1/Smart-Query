import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Platform, UpdateState } from '../shared/types';

export const IDLE_UPDATE: UpdateState = { status: 'idle', version: null, notes: null, progress: null, message: null, required: false };

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

interface Manifest {
  latest: string;
  minimum: string;
  url: string;
  sha256: string;
  notes: string | null;
}

/**
 * Checks driftsky.app for a newer version every few hours, downloads it on request, verifies its
 * SHA-256 against the release manifest, then opens the installer (DMG on Mac, setup on Windows).
 */
export class Updater {
  state: UpdateState = { ...IDLE_UPDATE };
  private manifest: Manifest | null = null;
  private file: string | null = null;

  constructor(
    private api: string,
    private platform: Platform,
    private version: string,
    private onChange: () => void,
    private openFile: (file: string) => Promise<string>,
    private fetchImpl: typeof fetch = fetch,
    /** Tests serve releases over plain http from localhost. */
    private allowHttp = false,
  ) {}

  private set(s: Partial<UpdateState>) {
    this.state = { ...this.state, ...s };
    this.onChange();
  }

  async check(manual = false): Promise<UpdateState> {
    if (this.state.status === 'downloading') return this.state;
    if (manual) this.set({ status: 'checking', message: null });
    try {
      const r = await this.fetchImpl(`${this.api}/api/app?platform=${this.platform === 'windows' ? 'windows' : 'mac'}`, { headers: { 'User-Agent': `Driftsky/${this.version}` } });
      if (r.status === 404) {
        this.set({ status: 'up-to-date', message: manual ? 'Driftsky is up to date.' : null });
        return this.state;
      }
      if (!r.ok) throw new Error(String(r.status));
      const m = (await r.json()) as Manifest;
      if (!/^\d+\.\d+\.\d+$/.test(m.latest) || !/^[a-f0-9]{64}$/.test(m.sha256) || !(/^https:\/\//.test(m.url) || (this.allowHttp && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(m.url)))) throw new Error('bad manifest');
      this.manifest = m;
      const required = !!m.minimum && compareVersions(this.version, m.minimum) < 0;
      if (compareVersions(m.latest, this.version) > 0) this.set({ status: this.file ? 'ready' : 'available', version: m.latest, notes: m.notes, required, message: null });
      else this.set({ status: 'up-to-date', version: null, required: false, message: manual ? 'Driftsky is up to date.' : null });
    } catch {
      this.set({ status: manual ? 'error' : this.state.status === 'checking' ? 'idle' : this.state.status, message: manual ? 'Driftsky’s server didn’t answer. Check that you’re online.' : this.state.message });
    }
    return this.state;
  }

  /** Download, verify, and open the installer. */
  async install(): Promise<UpdateState> {
    const m = this.manifest;
    if (!m) return this.set({ status: 'error', message: 'Check for updates first.' }), this.state;
    if (this.file && fs.existsSync(this.file)) {
      await this.openFile(this.file);
      return this.state;
    }
    this.set({ status: 'downloading', progress: 0, message: null });
    const ext = path.extname(new URL(m.url).pathname) || (this.platform === 'windows' ? '.exe' : '.dmg');
    const dest = path.join(os.tmpdir(), `Driftsky-${m.latest}${ext}`);
    try {
      const r = await this.fetchImpl(m.url);
      if (!r.ok || !r.body) throw new Error('download');
      const total = Number(r.headers.get('content-length')) || 0;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(dest);
      let got = 0;
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        got += value.length;
        if (!out.write(value)) await new Promise((res) => out.once('drain', res));
        if (total) this.set({ progress: Math.min(1, got / total) });
      }
      await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
      if (hash.digest('hex') !== m.sha256) {
        fs.rmSync(dest, { force: true });
        this.set({ status: 'error', progress: null, message: 'The download didn’t match the release, so nothing was installed.' });
        return this.state;
      }
      this.file = dest;
      this.set({ status: 'ready', progress: 1, message: this.platform === 'mac' ? 'Drag Driftsky into Applications to finish.' : 'Follow the installer to finish.' });
      const err = await this.openFile(dest);
      if (err) this.set({ status: 'error', message: 'Downloaded, but the installer wouldn’t open. Find it in your temporary folder.' });
    } catch {
      fs.rmSync(dest, { force: true });
      this.set({ status: 'error', progress: null, message: 'The download stopped. Check that you’re online and try again.' });
    }
    return this.state;
  }
}
