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
