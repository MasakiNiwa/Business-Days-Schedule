/**
 * アクセシビリティの自動検査（docs/SPEC.md §8.11）。
 *
 * 目で見て気づけない種類の欠落（名前の無い操作、コントラスト、ランドマーク）を
 * axe-core で機械的に確かめる。人手の確認を置き換えるものではないが、
 * 退行を止める網としては有効。
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function analyze(page: Page, context?: string): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
  ]);
  const results = await (context === undefined ? builder : builder.include(context)).analyze();
  const summary = results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' / ')}`,
  );
  expect(summary, summary.join('\n')).toEqual([]);
}

async function seedSamples(page: Page): Promise<void> {
  await page.goto('');
  await expect(page.locator('.empty-prompt')).toBeVisible();
  await page.getByRole('button', { name: 'サンプルを読み込む' }).click();
  await expect(page.locator('dialog .samples')).toBeVisible();
  await page
    .locator('.sample-item')
    .filter({ hasText: '基本セット' })
    .getByRole('button', { name: '追加', exact: true })
    .click();
  await expect(page.locator('.banner')).toContainText('追加');
  await page.locator('dialog .editor-actions').getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
}

test.describe('axe-core', () => {
  test('カレンダー表示', async ({ page }) => {
    await seedSamples(page);
    await analyze(page);
  });

  test('一覧表示', async ({ page }) => {
    await seedSamples(page);
    await page.getByRole('button', { name: '一覧' }).click();
    await analyze(page);
  });

  test('ルール編集', async ({ page }) => {
    await seedSamples(page);
    await page.locator('.header-actions').getByRole('button', { name: 'ルール', exact: true }).click();
    await page.getByRole('button', { name: '＋ 新規ルール' }).click();
    await analyze(page, 'dialog');
  });

  test('設定', async ({ page }) => {
    await seedSamples(page);
    await page.getByRole('button', { name: '設定' }).click();
    await analyze(page, 'dialog');
    for (const name of ['銀行休業日', 'バックアップ・書き出し', '祝日・アプリ情報']) {
      await page.getByRole('button', { name, exact: true }).click();
      await analyze(page, 'dialog');
    }
  });

  test('ヘルプ', async ({ page }) => {
    await page.goto('');
    await page.getByRole('button', { name: 'ヘルプ' }).click();
    await analyze(page, 'dialog');
  });
});

test.describe('キーボード操作', () => {
  test('本文へ移動できる', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('main#main')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await page.locator('.skip-link').press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('カレンダーは矢印キーで日を移動できる', async ({ page }) => {
    await seedSamples(page);
    const today = await page.locator('.cell.is-today .cell-day').getAttribute('data-date');
    expect(today).not.toBeNull();

    await page.locator('.cell.is-today .cell-day').focus();
    await page.keyboard.press('ArrowRight');
    const next = await page.evaluate(() => document.activeElement?.getAttribute('data-date'));
    expect(next).not.toBe(today);

    await page.keyboard.press('ArrowDown');
    const week = await page.evaluate(() => document.activeElement?.getAttribute('data-date'));
    expect(new Date(`${week}T00:00:00Z`).getTime()).toBeGreaterThan(
      new Date(`${next}T00:00:00Z`).getTime(),
    );
  });

  test('日をまたいで月が変わってもフォーカスが続く', async ({ page }) => {
    await seedSamples(page);
    const label = await page.locator('.month-label').innerText();
    await page.locator('.cell.is-today .cell-day').focus();
    // 月の外まで一気に進める。
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('PageDown');
    await expect(page.locator('.month-label')).not.toHaveText(label);
    const focused = await page.evaluate(() => document.activeElement?.className);
    expect(focused).toContain('cell-day');
  });

  test('タブ順にカレンダーの日ボタンは1つだけ入る', async ({ page }) => {
    await seedSamples(page);
    const tabbable = await page.locator('.cell-day[tabindex="0"]').count();
    expect(tabbable).toBe(1);
  });

  test('Esc でモーダルを閉じられる', async ({ page }) => {
    await page.goto('');
    await page.getByRole('button', { name: 'ヘルプ' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });
});
