import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 5199;
const TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'e2e/.tmp');

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // a real production build and server, with mock payments allowed for testing
    command: `rm -rf ${TMP} && mkdir -p ${TMP} && npm run build && node --disable-warning=ExperimentalWarning dist/server.js`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      PUBLIC_URL: `http://localhost:${PORT}`,
      PAYMENTS: 'mock',
      ALLOW_MOCK_PAYMENTS: '1',
      DEVICE_SALT: 'e2e-device-salt-0123456789abcdef',
      DATABASE_PATH: `${TMP}/e2e.db`,
      RELEASES_PATH: `${TMP}/releases.json`,
      STRIPE_WEBHOOK_SECRET: 'whsec_e2e',
    },
  },
});
