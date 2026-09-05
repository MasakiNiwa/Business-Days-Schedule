/**
 * Service Worker の登録が、初めて開いた人の邪魔をしないこと。
 *
 * clients.claim() は初回登録でも controllerchange を起こす。
 * これを更新と取り違えて読み込み直すと、初回訪問が必ず1回リロードされ、
 * 入力途中のフォームも巻き込む。実際にその状態になっていた。
 */

import { expect, test } from '@playwright/test';

test('初回訪問で勝手に読み込み直さない', async ({ page }) => {
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });

  await page.goto('');
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active !== undefined;
  });

  // 入力途中のものが失われないことを、実際に文字を入れて確かめる。
  await page.locator('.header-actions').getByRole('button', { name: 'ルール', exact: true }).click();
  await page.getByRole('button', { name: '＋ 新規ルール' }).click();
  await page.getByLabel('タイトル').fill('入力途中');

  await page.waitForTimeout(1500);

  await expect(page.getByLabel('タイトル')).toHaveValue('入力途中');
  expect(navigations, '初回訪問での遷移は最初の1回だけ').toBe(1);
});
