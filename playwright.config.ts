import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}/Business-Days-Schedule/`;

/**
 * E2E は本番ビルド（dist/）を素の静的配信で動かす。
 * GitHub Pages と同じ条件に近づけ、公開後にだけ壊れる不具合を拾うため。
 */
/**
 * ブラウザの実体を差し替えるための逃げ道。
 * CI では playwright install が入れたものを使う。手元で別の場所にある場合だけ指定する。
 */
const executablePath = process.env['PW_CHROMIUM_PATH'];
const launchOptions = executablePath === undefined ? {} : { executablePath };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] === undefined ? 0 : 1,
  workers: process.env['CI'] === undefined ? undefined : 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, launchOptions },
    },
    { name: 'mobile', use: { ...devices['Pixel 5'], launchOptions } },
  ],
  webServer: {
    command: 'npm run serve:dist',
    url: BASE_URL,
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 60_000,
  },
});
