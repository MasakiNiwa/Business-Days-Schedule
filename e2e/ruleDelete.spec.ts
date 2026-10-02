/**
 * ルール一覧から直接消す（docs/SPEC.md §8.1）。
 * 狭い画面では行を左へ払うと削除ボタンが出る。消したら〈元に戻す〉で戻せる。
 */

import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

const STORAGE_KEY = 'bds.v1.rules';

const rule = (id: string, title: string) => ({
  id,
  title,
  color: 'blue',
  enabled: true,
  calendarId: 'company',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
  notices: [],
  period: { start: null, end: null },
  skipDates: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** 行を左へ払う。Playwright の touchscreen はタップしか持たないので、イベントを組み立てる。 */
async function swipeLeft(row: Locator): Promise<void> {
  await row.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const make = (type: string, x: number) => {
      const touch = new Touch({ identifier: 1, target: element, clientX: x, clientY: box.top + 10 });
      return new TouchEvent(type, {
        bubbles: true,
        touches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch],
      });
    };
    element.dispatchEvent(make('touchstart', box.right - 20));
    element.dispatchEvent(make('touchend', box.right - 160));
  });
}

test('一覧から消して、元に戻せる', async ({ page, isMobile }) => {
  await page.addInitScript(
    ([key, rules]) => {
      if (window.localStorage.getItem(key as string) === null) {
        window.localStorage.setItem(key as string, rules as string);
      }
    },
    [STORAGE_KEY, JSON.stringify([rule('a', '給与振込'), rule('b', '月次締め')])],
  );
  await page.goto('');
  await page.locator('.app-nav').getByRole('button', { name: 'ルール' }).click();

  const row = page.locator('li.rule', { hasText: '給与振込' });
  const remove = row.getByRole('button', { name: '「給与振込」を削除' });

  if (isMobile) {
    // 狭い画面では、払うまで削除ボタンは画面の外にある。
    await expect(remove).not.toBeInViewport();
    await swipeLeft(row);
    await expect(row).toHaveClass(/is-revealed/);
    await expect(remove).toBeInViewport();
    // 払った直後（0.4秒以内）の click は、払う動作から出たものとして握り潰される。
    // 指を離してから押し直す間を置く。
    await page.waitForTimeout(500);
  } else {
    await expect(remove).toBeVisible();
  }

  await remove.click();
  await expect(page.locator('li.rule')).toHaveCount(1);
  const toast = page.locator('.banner-toast');
  await expect(toast).toContainText('「給与振込」を削除しました。');
  await expect(toast).toBeInViewport();

  await toast.getByRole('button', { name: '元に戻す' }).click();
  await expect(page.locator('li.rule .rule-title')).toHaveText(['給与振込', '月次締め']);

  await page.reload();
  await page.locator('.app-nav').getByRole('button', { name: 'ルール' }).click();
  await expect(page.locator('li.rule')).toHaveCount(2);
});
