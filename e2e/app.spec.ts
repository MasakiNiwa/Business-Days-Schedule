/**
 * ブラウザでの通し確認。
 *
 * 単体テストでは拾えない「編集 → 再読込 → 再追加」のような、
 * 保存と画面をまたぐ流れを対象にする。実際にこの種の不具合を取り逃がしていた。
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const STORAGE_KEY = 'bds.v1.rules';

/** ヘッダーの「ルール」ボタン。空状態の「ルールを追加」と紛れないよう厳密に選ぶ。 */
async function openRulePanel(page: Page): Promise<void> {
  await page.locator('.header-actions').getByRole('button', { name: 'ルール', exact: true }).click();
}

/** モーダルの本文にある「閉じる」。右上の × と紛れないようにする。 */
async function closeDialog(page: Page): Promise<void> {
  await page.locator('dialog .editor-actions').getByRole('button', { name: '閉じる' }).click();
}

async function loadSamplePack(page: Page, name: string): Promise<void> {
  await openRulePanel(page);
  await expect(page.locator('dialog .rule-panel')).toBeVisible();
  await page.getByRole('button', { name: 'サンプル', exact: true }).click();
  await expect(page.locator('dialog .samples')).toBeVisible();
  await page
    .locator('.sample-item')
    .filter({ hasText: name })
    .getByRole('button', { name: '追加', exact: true })
    .click();
  await expect(page.locator('.banner')).toContainText('追加');
}

test.describe('初回起動と永続化', () => {
  test('空の状態から サンプル追加 → 再読込しても残る', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('.empty-prompt')).toBeVisible();

    await page.getByRole('button', { name: 'サンプルを読み込む' }).click();
    await page
      .locator('.sample-item')
      .filter({ hasText: '基本セット' })
      .getByRole('button', { name: '追加', exact: true })
      .click();
    await closeDialog(page);

    await expect(page.locator('.empty-prompt')).toHaveCount(0);
    await expect(page.locator('.chip').first()).toBeVisible();

    await page.reload();
    await expect(page.locator('.chip').first()).toBeVisible();
    await expect(page.locator('.empty-prompt')).toHaveCount(0);
  });
});

test.describe('サンプルの再追加で編集内容を守る', () => {
  test('名前を変えたあと同じ束を追加しても上書きされない', async ({ page }) => {
    await page.goto('');
    await loadSamplePack(page, '基本セット');
    await closeDialog(page);

    // 1件の名前を変える。
    await openRulePanel(page);
    await page.locator('.rule').filter({ hasText: '月次締め' }).getByRole('button', { name: '編集' }).click();
    const title = page.getByLabel('タイトル');
    await title.fill('月次締め（自社ルール）');
    await page.getByRole('button', { name: '保存' }).click();

    // 再読込してから、同じ束をもう一度追加する。
    await page.reload();
    await loadSamplePack(page, '基本セット');
    await closeDialog(page);

    await openRulePanel(page);
    await expect(page.locator('.rule-title').filter({ hasText: '月次締め（自社ルール）' })).toHaveCount(1);
    await expect(page.locator('.rule-title').filter({ hasText: /^月次締め$/ })).toHaveCount(0);
  });
});

test.describe('長い事前通知', () => {
  test('60営業日前の通知が該当月に出る', async ({ page }) => {
    // UI で作ると手数が多いので、保存データを直接与えて表示だけを確かめる。
    await page.addInitScript(
      ([key, rules]) => window.localStorage.setItem(key as string, rules as string),
      [
        STORAGE_KEY,
        JSON.stringify([
          {
            id: 'long-notice',
            title: '長期準備',
            color: 'blue',
            enabled: true,
            calendarId: 'company',
            recurrence: { type: 'monthlyByDay', interval: 1, months: [11], days: [30], overflow: 'clamp' },
            adjust: { mode: 'prev', keepInMonth: false },
            notices: [{ offset: -60, unit: 'business', label: '準備開始' }],
            period: { start: null, end: null },
            skipDates: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      ],
    );
    await page.goto('');

    // 2026-08 へ移動する。
    await page.locator('.month-label').click();
    await expect(page.locator('.picker')).toBeVisible();
    const year = await page.locator('.picker-year').innerText();
    while ((await page.locator('.picker-year').innerText()) !== '2026') {
      await page.locator('.picker-head button').nth(year > '2026' ? 0 : 1).click();
    }
    await page.locator('.picker-month').filter({ hasText: '8月' }).click();

    await expect(page.locator('.chip.is-notice')).toHaveCount(1);
    await expect(page.locator('.chip.is-notice')).toContainText('準備開始');
  });
});

test.describe('書き出し', () => {
  test('iCalendar のセミコロンがエスケープされる', async ({ page }) => {
    await page.addInitScript(
      ([key, rules]) => window.localStorage.setItem(key as string, rules as string),
      [
        STORAGE_KEY,
        JSON.stringify([
          {
            id: 'semi',
            title: '締切;厳守',
            color: 'red',
            enabled: true,
            calendarId: 'company',
            recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
            adjust: { mode: 'none', keepInMonth: false },
            notices: [],
            period: { start: null, end: null },
            skipDates: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      ],
    );
    await page.goto('');
    await page.getByRole('button', { name: '設定' }).click();
    await page.getByRole('button', { name: 'Google カレンダー / Outlook 用に書き出す' }).click();
    await page.getByRole('button', { name: '今日から3か月' }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '書き出す' }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const ics = Buffer.concat(chunks).toString('utf-8').split('\r\n ').join('');

    expect(ics).toContain(String.raw`SUMMARY:締切\;厳守`);
    expect(ics).toContain('BEGIN:VEVENT');
  });
});

test.describe('入力欄の名前', () => {
  test('ラベルが入力欄と結び付いている', async ({ page }) => {
    await page.goto('');
    await openRulePanel(page);
    await page.getByRole('button', { name: '＋ 新規ルール' }).click();

    // プレースホルダーではなくラベルで引けること。
    await expect(page.getByLabel('タイトル')).toBeVisible();
    await expect(page.getByLabel('営業日カレンダー')).toBeVisible();
    await expect(page.getByLabel('メモ')).toBeVisible();
  });

  test('第N営業日では補正欄を出さない', async ({ page }) => {
    await page.goto('');
    await openRulePanel(page);
    await page.getByRole('button', { name: '＋ 新規ルール' }).click();

    await expect(page.getByLabel('補正', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '第N営業日' }).click();
    await expect(page.getByLabel('補正', { exact: true })).toBeHidden();
    await expect(page.locator('.editor-section').filter({ hasText: '休業日にあたったとき' })).toContainText(
      '補正の設定はありません',
    );
  });
});

test.describe('表示', () => {
  test('横スクロールが出ない', async ({ page }) => {
    await page.goto('');
    await loadSamplePack(page, '基本セット');
    await closeDialog(page);

    const overflow = await page.evaluate(
      () => document.body.scrollWidth > document.body.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test('印刷では白地・黒文字になる', async ({ page }) => {
    await page.goto('');
    await page.emulateMedia({ media: 'print' });
    const colors = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      foreground: getComputedStyle(document.documentElement).getPropertyValue('--fg').trim(),
    }));
    expect(colors.background).toBe('rgb(255, 255, 255)');
    expect(colors.foreground).toBe('#000');
  });
});
