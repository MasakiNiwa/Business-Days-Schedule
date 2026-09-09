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
      // 更新案内の検査は dist を作り直すので、並行して走る側からは外す
      // （作り直している最中の dist を他の検査が読むと、あるはずの資産が無い）。
      testIgnore: /updatePrompt\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, launchOptions },
    },
    {
      name: 'mobile',
      testIgnore: /updatePrompt\.spec\.ts/,
      use: { ...devices['Pixel 5'], launchOptions },
    },
    {
      // dist を作り直しながら確かめるため、単独で順に走らせる（npm run e2e:update）。
      // 画面幅に関係しない検査なので、1つの画面幅だけで足りる。
      name: 'update',
      testMatch: /updatePrompt\.spec\.ts/,
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, launchOptions },
    },
  ],
  webServer: {
    command: 'npm run serve:dist',
    url: BASE_URL,
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 60_000,
  },
});
