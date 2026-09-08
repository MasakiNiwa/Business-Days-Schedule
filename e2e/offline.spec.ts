/**
 * オフライン対応（docs/SPEC.md §13）。
 *
 * 一度開いたあとは、通信が無くても使えることを確かめる。
 * 外出先や電波の悪い場所で開けないと、日々の道具としては使えないため。
 */

import { expect, test } from '@playwright/test';

test.describe('Service Worker', () => {
  test('登録され、オフラインでも開ける', async ({ page, context }) => {
    await page.goto('');
    await page.getByRole('button', { name: 'サンプルを読み込む' }).click();
    await page
      .locator('.sample-item')
      .filter({ hasText: '基本セット' })
      .getByRole('button', { name: '追加', exact: true })
      .click();
    await page.locator('dialog .editor-actions').getByRole('button', { name: '閉じる' }).click();

    // 登録が終わり、ページを制御下に置くまで待つ。
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active !== undefined && navigator.serviceWorker.controller !== null;
    });

    await context.setOffline(true);
    await page.reload();

    // 画面が出て、祝日データも読めている（＝休業日の判定ができている）。
    await expect(page.locator('.calendar')).toBeVisible();
    await expect(page.locator('.chip').first()).toBeVisible();
    await expect(page.locator('.cell.is-closed').first()).toBeVisible();
    await expect(page.locator('.month-summary')).toContainText('営業日');

    await context.setOffline(false);
  });

  test('版が画面に出る', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('.brand')).toHaveText('Business Days Schedule');
    await expect(page.locator('.brand-tagline')).toContainText('Outlook');
    await expect(page.locator('.brand-version')).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(page.locator('.footer-version')).toContainText('Business Days Schedule v');
  });

  test('設定に版の詳細が出る', async ({ page }) => {
    await page.goto('');
    await page.getByRole('button', { name: '設定' }).click();
    await page.getByRole('button', { name: '祝日・アプリ情報', exact: true }).click();
    const about = page.locator('dialog .editor-section').filter({ hasText: 'このアプリについて' });
    await expect(about).toContainText('版');
    await expect(about).toContainText(/v\d+\.\d+\.\d+/);
  });
});

test.describe('公開中の祝日データ', () => {
  test('公開成果物に版が置いてあり、次のデプロイから読み戻せる', async ({ page, baseURL }) => {
    // これが無いと、取得に失敗したときの代替がリポジトリの版だけになり、
    // 週次で更新したぶんを巻き戻してしまう（docs/SPEC.md §3.4）。
    const response = await page.request.get(new URL('data/holidays.json', baseURL).href);
    expect(response.ok()).toBe(true);
    const data = (await response.json()) as {
      meta: { source: string; fetchedAt: string; count: number };
    };
    expect(data.meta.source).toBe('holiday-jp/holiday_jp');
    expect(Number.isFinite(Date.parse(data.meta.fetchedAt))).toBe(true);
    expect(data.meta.count).toBeGreaterThan(0);
  });

  test('アプリはこのファイルを起動時に取りに行かない', async ({ page }) => {
    // 同梱ぶんを使う（§3.5）。置いてあるのは次のデプロイのための記録。
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    await page.goto('');
    await page.locator('.app-header').waitFor();
    expect(requested.filter((url) => url.includes('data/holidays.json'))).toEqual([]);
  });
});
