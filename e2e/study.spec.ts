/**
 * 学習（docs/SPEC.md §8.13）の通し確認。FSRS-7（ts-fsrs 6）。
 *
 * 学習の画面は初めて開いたときに読み込む。本番ビルドで、読み込み・復習・保存・
 * 再読込のあとも続くこと・オフラインでも開けることを確かめる。
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function seedSamples(page: Page): Promise<void> {
  await page.goto('');
  await page.getByRole('button', { name: '完成例を見る' }).click();
  await page
    .locator('.sample-item')
    .filter({ hasText: '基本セット' })
    .getByRole('button', { name: '追加', exact: true })
    .click();
  await expect(page.locator('.banner-ok')).toContainText('追加');
  await page.locator('dialog .editor-actions').getByRole('button', { name: '閉じる' }).click();
}

test.describe('学習', () => {
  test('復習して評価すると記録が残り、再読込しても続く', async ({ page }) => {
    await seedSamples(page);
    await page.locator('.app-nav').getByRole('button', { name: '学習' }).click();
    const start = page.getByRole('button', { name: /^復習を始める（\d+ 件）$/ });
    await expect(start).toBeVisible();
    const before = Number((await start.textContent())?.match(/\d+/)?.[0]);

    await start.click();
    const title = await page.locator('.study-card-title').textContent();
    await page.getByRole('button', { name: '答えを見る' }).click();
    // 答えの日付は、アプリの営業日計算で出す。
    await expect(page.locator('.study-answer .preview-list li').first()).toBeVisible();
    await page.locator('.study-rating-3').click();
    await page.getByRole('button', { name: '終わる' }).click();

    await expect(page.getByRole('button', { name: `復習を始める（${before - 1} 件）` })).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bds.v1.study') ?? '{}'));
    expect(Object.keys(saved.cards)).toHaveLength(1);

    await page.reload();
    await page.locator('.app-nav').getByRole('button', { name: '学習' }).click();
    const learnedRow = page.locator('.study-rule', { hasText: title ?? '' });
    await expect(learnedRow.locator('.study-rule-value')).toHaveText(/^定着 \d+%$/);
    await learnedRow.locator('summary').click();
    await expect(learnedRow.locator('svg.study-curve')).toBeVisible();
    await expect(learnedRow.locator('.study-past li').first()).toBeVisible();
  });

  test('一度開いたあとは、オフラインでも学習の画面を開ける', async ({ page, context }) => {
    await seedSamples(page);
    // Service Worker が控えるのを待つ（事前キャッシュに学習の画面の部品も入る）。
    await page.waitForFunction(async () => (await navigator.serviceWorker.ready) !== undefined);
    await page.reload();
    await context.setOffline(true);
    await page.locator('.app-nav').getByRole('button', { name: '学習' }).click();
    await expect(page.locator('.study-stats')).toBeVisible();
    await context.setOffline(false);
  });
});
