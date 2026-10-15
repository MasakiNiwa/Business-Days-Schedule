/**
 * AI で予定を作る（docs/SPEC.md §9.5）の通し確認。
 *
 * コピー → （利用者が AI に貼る）→ 回答を貼り付け → 確認 → 登録。
 * このアプリ自身は AI と通信しないので、AI の回答は手で用意する。
 */

import { expect, test } from '@playwright/test';

const STORAGE_KEY = 'bds.v1.rules';

const AI_REPLY = `以下の設定になります。

\`\`\`json
{
  "format": "business-days-schedule-ai-import",
  "schemaVersion": 1,
  "rules": [
    {
      "title": "支払",
      "calendarId": "bank",
      "recurrence": { "type": "monthlyByDay", "days": [25] },
      "adjust": { "mode": "prev" },
      "notices": [
        { "label": "振込データ作成", "timing": { "kind": "offset", "offset": -3, "unit": "business" } },
        { "label": "支払確認", "timing": { "kind": "offset", "offset": 1, "unit": "business" } }
      ]
    }
  ]
}
\`\`\`

必要に応じて調整してください。`;

test.describe('AIで予定を作る', () => {
  test('コピー → 貼り付け → 確認 → 登録', async ({ page, context, browserName }) => {
    // クリップボードの読み書きを許す（Chromium のみ対応）。
    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    }
    // このアプリから外へ出ていく通信が無いことも確かめる。
    const external: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1')) external.push(request.url());
    });

    await page.goto('');
    await page.locator('.empty-prompt').getByRole('button', { name: 'AIで作る' }).click();
    const dialog = page.locator('dialog .ai-import');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'AIへの依頼文をコピー' }).click();
    // 写せた・写せなかったのどちらでも、利用者が次へ進める案内が出る。
    await expect(dialog.locator('.ai-copy-status')).toContainText(/コピー/);

    await dialog.getByLabel('AIから返ってきた内容を貼り付け').fill(AI_REPLY);
    await dialog.getByRole('button', { name: '内容を確認' }).click();

    const review = dialog.locator('.ai-review');
    await expect(review).toContainText('AIから次の予定が作成されました（1 件）');
    await expect(review.locator('.rule-desc')).toHaveText('毎月25日 / 休業日なら前営業日');
    await expect(review.locator('.preview-list > li').first()).toBeVisible();

    // まだ保存していない。
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();

    await review.getByRole('button', { name: 'この内容で登録' }).click();
    await expect(page.locator('.banner-ok', { hasText: '「支払」を登録しました。' })).toBeVisible();
    await expect(page.locator('dialog .ai-import')).toHaveCount(0);

    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), STORAGE_KEY);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ title: '支払', calendarId: 'bank' });

    // 再読込しても残る。
    await page.reload();
    await expect(page.locator('.chip').first()).toBeVisible();
    expect(external).toEqual([]);
  });

  test('読み込めない回答は理由を出し、保存しない', async ({ page }) => {
    await page.goto('');
    await page.locator('.empty-prompt').getByRole('button', { name: 'AIで作る' }).click();
    const dialog = page.locator('dialog .ai-import');
    await dialog
      .getByLabel('AIから返ってきた内容を貼り付け')
      .fill(AI_REPLY.replace('"mode": "prev"', '"mode": "previousBusinessDay"'));
    await dialog.getByRole('button', { name: '内容を確認' }).click();

    await expect(dialog.locator('.ai-errors')).toContainText('「休業日の扱い」に、このアプリでは使えない設定');
    await expect(dialog.getByRole('button', { name: 'AIへ修正を依頼する文をコピー' })).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  });

  test('登録済みの予定を渡して直し、変更前と変更後を見てから反映する', async ({ page }) => {
    await page.goto('');
    await page.locator('.empty-prompt').getByRole('button', { name: 'AIで作る' }).click();
    let dialog = page.locator('dialog .ai-import');
    await dialog.getByLabel('AIから返ってきた内容を貼り付け').fill(AI_REPLY);
    await dialog.getByRole('button', { name: '内容を確認' }).click();
    await dialog.getByRole('button', { name: 'この内容で登録' }).click();
    await expect(page.locator('dialog .ai-import')).toHaveCount(0);

    // 〈ルール〉→〈AIで作る〉→「今の予定を直す」。
    await page.getByRole('button', { name: 'ルール', exact: true }).first().click();
    await page.getByRole('button', { name: 'AIで作る' }).first().click();
    dialog = page.locator('dialog .ai-import');
    await dialog.getByRole('button', { name: '今の予定を直す' }).click();
    await expect(dialog.locator('.ai-share-summary')).toContainText('予定 1 件');

    // 依頼文に入った予定の行を、AI が写して直したことにする。
    await dialog.getByText('依頼文を表示').click();
    const prompt = await dialog.locator('.ai-copy-box textarea').inputValue();
    const line = prompt.split('\n').find((text) => text.startsWith('{"id":'));
    expect(line).toBeDefined();
    const edited = { ...JSON.parse(line ?? '{}'), adjust: { mode: 'next', keepInMonth: false } };
    const reply = `\`\`\`json\n${JSON.stringify({ format: 'business-days-schedule-ai-import', schemaVersion: 1, rules: [edited] })}\n\`\`\``;

    await dialog.getByLabel('AIから返ってきた内容を貼り付け').fill(reply);
    await dialog.getByRole('button', { name: '内容を確認' }).click();
    const review = dialog.locator('.ai-review');
    await expect(review).toContainText('AIから次の内容が届きました（変更 1 件）');
    await expect(review.locator('.ai-changes')).toContainText('変更後: 毎月25日 / 休業日なら翌営業日');

    await review.getByRole('button', { name: 'この内容で反映（変更 1 件）' }).click();
    await expect(page.locator('.banner-ok', { hasText: '1 件を変更しました。' })).toBeVisible();
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), STORAGE_KEY);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ title: '支払', adjust: { mode: 'next' } });
  });
});
