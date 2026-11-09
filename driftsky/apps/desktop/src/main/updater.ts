import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
  /** The verified download, tied to the exact release it belongs to. */
  private file: { path: string; version: string; sha256: string } | null = null;
  private installing: Promise<UpdateState> | null = null;
  /** Abort a download that sends nothing for this long. */
  stallMs = 30_000;
  /** Refuse anything bigger than this (a real installer is ~150 MB). */
  maxBytes = 600 * 1024 * 1024;

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
      const r = await this.fetchImpl(`${this.api}/api/app?platform=${this.platform === 'windows' ? 'windows' : 'mac'}`, {
        headers: { 'User-Agent': `Driftsky/${this.version}` },
      });
      if (r.status === 404) {
        this.set({ status: 'up-to-date', message: manual ? 'Driftsky is up to date.' : null });
        return this.state;
      }
      if (!r.ok) throw new Error(String(r.status));
      const m = (await r.json()) as Manifest;
      if (
        !/^\d+\.\d+\.\d+$/.test(m.latest) ||
        !/^[a-f0-9]{64}$/.test(m.sha256) ||
        !(/^https:\/\//.test(m.url) || (this.allowHttp && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(m.url)))
      )
        throw new Error('bad manifest');
      this.manifest = m;
      const required = !!m.minimum && compareVersions(this.version, m.minimum) < 0;
      const haveIt = this.file && this.file.version === m.latest && this.file.sha256 === m.sha256;
      if (!haveIt) this.file = null;
      if (compareVersions(m.latest, this.version) > 0)
        this.set({ status: haveIt ? 'ready' : 'available', version: m.latest, notes: m.notes, required, message: null });
      else this.set({ status: 'up-to-date', version: null, required: false, message: manual ? 'Driftsky is up to date.' : null });
    } catch {
      this.set({
        status: manual ? 'error' : this.state.status === 'checking' ? 'idle' : this.state.status,
        message: manual ? 'Driftsky’s server didn’t answer. Check that you’re online.' : this.state.message,
      });
    }
    return this.state;
  }

  /** Download, verify, and open the installer. One at a time. */
  install(): Promise<UpdateState> {
    this.installing ??= this.doInstall().finally(() => (this.installing = null));
    return this.installing;
  }

  private async doInstall(): Promise<UpdateState> {
    const m = this.manifest;
    if (!m) return this.set({ status: 'error', message: 'Check for updates first.' }), this.state;
    // reuse an earlier download only if it's this exact release and still intact
    if (this.file && this.file.version === m.latest && this.file.sha256 === m.sha256 && (await sha256File(this.file.path)) === m.sha256) {
      await this.openFile(this.file.path);
      return this.state;
    }
    this.file = null;
    this.set({ status: 'downloading', progress: 0, message: null });
    const ext = path.extname(new URL(m.url).pathname) || (this.platform === 'windows' ? '.exe' : '.dmg');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftsky-update-'));
    const dest = path.join(dir, `Driftsky-${m.latest}${ext}`);
    const ctrl = new AbortController();
    let stall: NodeJS.Timeout | undefined;
    const kick = () => {
      clearTimeout(stall);
      stall = setTimeout(() => ctrl.abort(), this.stallMs);
    };
    try {
      kick();
      const r = await this.fetchImpl(m.url, { signal: ctrl.signal });
      if (!r.ok || !r.body) throw new Error('download');
      const total = Number(r.headers.get('content-length')) || 0;
      if (total > this.maxBytes) throw new Error('too big');
      const hash = crypto.createHash('sha256');
      let got = 0;
      let lastReport = 0;
      const meter = new Transform({
        transform: (chunk: Buffer, _enc, cb) => {
          kick();
          got += chunk.length;
          if (got > this.maxBytes) return cb(new Error('too big'));
          hash.update(chunk);
          if (total && got - lastReport > total / 50) {
            lastReport = got;
            this.set({ progress: Math.min(1, got / total) });
          }
          cb(null, chunk);
        },
      });
      // disk full, locked file, or a dropped connection all reject here instead of crashing
      await pipeline(Readable.fromWeb(r.body as never), meter, fs.createWriteStream(dest), { signal: ctrl.signal });
      clearTimeout(stall);
      if (hash.digest('hex') !== m.sha256) {
        fs.rmSync(dir, { recursive: true, force: true });
        this.set({ status: 'error', progress: null, message: 'The download didn’t match the release, so nothing was installed.' });
        return this.state;
      }
      this.file = { path: dest, version: m.latest, sha256: m.sha256 };
      this.set({
        status: 'ready',
        progress: 1,
        message: this.platform === 'mac' ? 'Drag Driftsky into Applications to finish.' : 'Follow the installer to finish.',
      });
      const err = await this.openFile(dest);
      if (err) this.set({ status: 'error', message: 'Downloaded, but the installer wouldn’t open. Try again.' });
    } catch {
      clearTimeout(stall);
      fs.rmSync(dir, { recursive: true, force: true });
      this.set({
        status: 'error',
        progress: null,
        message: ctrl.signal.aborted
          ? 'The download stopped and couldn’t pick up again. Try again in a moment.'
          : 'The download failed. Check that you’re online and have some free disk space, then try again.',
      });
    }
    return this.state;
  }
}

async function sha256File(file: string): Promise<string | null> {
  try {
    const h = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(file), h);
    return h.digest('hex');
  } catch {
    return null;
  }
}
