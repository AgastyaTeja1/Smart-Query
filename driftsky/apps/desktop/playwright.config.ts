import { defineConfig } from '@playwright/test';
import path from 'node:path';

export const WEB_PORT = 5196;
export const TMP = path.join(__dirname, 'e2e/.tmp');
const web = path.resolve(__dirname, '../web');

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'off' },
  // the real license server (production build) that the app talks to
  webServer: {
    command: `rm -rf ${TMP} && mkdir -p ${TMP}/files && (test -f ${web}/dist/server.js || npm run build --prefix ${web}) && node --disable-warning=ExperimentalWarning ${web}/dist/server.js`,
    url: `http://localhost:${WEB_PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'production',
      PORT: String(WEB_PORT),
      PUBLIC_URL: `http://localhost:${WEB_PORT}`,
      PAYMENTS: 'mock',
      ALLOW_MOCK_PAYMENTS: '1',
      DEVICE_SALT: 'desktop-e2e-salt-0123456789',
      DATABASE_PATH: `${TMP}/web.db`,
      RELEASES_PATH: `${TMP}/releases.json`,
      FILES_DIR: `${TMP}/files`,
    },
  },
});
