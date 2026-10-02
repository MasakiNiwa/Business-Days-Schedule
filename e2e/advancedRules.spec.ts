/**
 * 編集画面の「詳細」（docs/SPEC.md §8.4）。
 * 使う人が限られる設定は畳んであり、開けば選べる。
 */

import { expect, test } from '@playwright/test';

test('畳んだ「ほかの繰り返し方」から毎営業日を作れる', async ({ page }) => {
  await page.goto('');
  await page.locator('.app-nav').getByRole('button', { name: 'ルール' }).click();
  await page.getByRole('button', { name: '＋ 新規ルール' }).click();
  await page.getByRole('button', { name: '自由入力' }).click();
  await page.getByLabel('タイトル').fill('残高確認');

  // ふだんは畳んであり、毎営業日のタブは見えない。
  const extra = page.locator('details.recurrence-extra');
  await expect(extra.getByRole('button', { name: '毎営業日・N営業日ごと' })).toBeHidden();
  await extra.locator('summary').click();
  await extra.getByRole('button', { name: '毎営業日・N営業日ごと' }).click();

  // 必ず営業日なので、休業日の扱いは出さない。
  await expect(page.locator('.adjust-controls')).toBeHidden();
  await expect(page.locator('.rule-summary')).toContainText('毎営業日');

  await page.getByRole('button', { name: '保存' }).click();
  await page.locator('.app-nav').getByRole('button', { name: 'ルール' }).click();
  await expect(page.locator('li.rule', { hasText: '残高確認' }).locator('.rule-desc')).toHaveText('毎営業日');
});

test('休業日の扱いで「その回は行わない」を選べる', async ({ page }) => {
  await page.goto('');
  await page.locator('.app-nav').getByRole('button', { name: 'ルール' }).click();
  await page.getByRole('button', { name: '＋ 新規ルール' }).click();
  await page.getByRole('button', { name: '自由入力' }).click();
  await page.getByLabel('タイトル').fill('定例');
  await page.getByRole('button', { name: '毎週', exact: true }).click();
  await page.getByLabel('休業日の場合', { exact: true }).selectOption('skip');
  await expect(page.locator('.rule-summary')).toContainText('休業日ならその回は行わない');
  await page.getByRole('button', { name: '保存' }).click();
  await page.locator('.app-nav').getByRole('button', { name: 'ルール' }).click();
  await expect(page.locator('li.rule', { hasText: '定例' }).locator('.rule-desc')).toContainText(
    '休業日ならその回は行わない',
  );
});
