/**
 * @vitest-environment jsdom
 *
 * 月の移動。前後1か月ずつ送らずに離れた月へ飛べることが目的なので、
 * 年をまたいで選べること・今日の月が分かることを固定する。
 */

import { describe, expect, it, vi } from 'vitest';
import { renderMonthPicker } from '../src/ui/MonthPicker';
import type { MonthPickerHandlers } from '../src/ui/MonthPicker';

import type { Month } from '../src/types';

type YearMonth = { year: number; month: Month };

const TODAY: YearMonth = { year: 2026, month: 9 };

function open(
  current: YearMonth = { year: 2026, month: 9 },
): { element: HTMLElement; handlers: MonthPickerHandlers } {
  const handlers: MonthPickerHandlers = {
    onSelect: vi.fn(),
    onToday: vi.fn(),
    onClose: vi.fn(),
  };
  return { element: renderMonthPicker(current, TODAY, handlers), handlers };
}

const monthButtons = (root: ParentNode): HTMLButtonElement[] =>
  [...root.querySelectorAll<HTMLButtonElement>('.picker-month')];

const clickText = (root: ParentNode, text: string): void => {
  [...root.querySelectorAll('button')]
    .find((b) => b.textContent === text)
    ?.dispatchEvent(new MouseEvent('click'));
};

describe('renderMonthPicker', () => {
  it('12か月ぶんのボタンを出す', () => {
    const { element } = open();
    expect(monthButtons(element).map((b) => b.textContent)).toEqual([
      '1月', '2月', '3月', '4月', '5月', '6月',
      '7月', '8月', '9月', '10月', '11月', '12月',
    ]);
    expect(element.querySelector('.picker-year')?.textContent).toBe('2026');
  });

  it('表示中の月と今日の月に印を付ける', () => {
    const { element } = open({ year: 2026, month: 3 });
    const march = monthButtons(element).find((b) => b.textContent === '3月');
    const september = monthButtons(element).find((b) => b.textContent === '9月');
    expect(march?.getAttribute('aria-pressed')).toBe('true');
    expect(september?.getAttribute('aria-pressed')).toBe('false');
    expect(september?.className).toContain('is-today');
  });

  it('月を選ぶと年month付きで通知する', () => {
    const { element, handlers } = open();
    monthButtons(element).find((b) => b.textContent === '4月')?.dispatchEvent(new MouseEvent('click'));
    expect(handlers.onSelect).toHaveBeenCalledWith(2026, 4);
  });

  it('年を送ってから月を選べる', () => {
    const { element, handlers } = open();
    clickText(element, '›');
    clickText(element, '›');
    expect(element.querySelector('.picker-year')?.textContent).toBe('2028');
    monthButtons(element).find((b) => b.textContent === '4月')?.dispatchEvent(new MouseEvent('click'));
    expect(handlers.onSelect).toHaveBeenCalledWith(2028, 4);
  });

  it('年を戻せる。今日の印も年に追従する', () => {
    const { element } = open();
    clickText(element, '‹');
    expect(element.querySelector('.picker-year')?.textContent).toBe('2025');
    expect(element.querySelectorAll('.picker-month.is-today')).toHaveLength(0);
  });

  it('今日の月へ・閉じるを呼べる', () => {
    const { element, handlers } = open();
    clickText(element, '今日の月へ');
    clickText(element, '閉じる');
    expect(handlers.onToday).toHaveBeenCalledOnce();
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });
});
