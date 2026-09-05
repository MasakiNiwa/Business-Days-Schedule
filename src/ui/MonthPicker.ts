/**
 * 月の移動（前後の1か月だけでなく、離れた月へ直接飛ぶための画面）。
 *
 * 「毎年4月1日」のようなルールを確かめたいとき、‹ › を何度も押すのは現実的でない。
 */

import type { Month } from '../types';
import { button } from './controls';
import { clear, h } from './dom';

export type MonthPickerHandlers = {
  onSelect: (year: number, month: Month) => void;
  onToday: () => void;
  onClose: () => void;
};

const MONTHS: Month[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function renderMonthPicker(
  current: { year: number; month: Month },
  today: { year: number; month: Month },
  handlers: MonthPickerHandlers,
): HTMLElement {
  // 表示中の年は、選び直しの途中でも保持する（年を送ってから月を選べるように）。
  let year = current.year;

  const yearLabel = h('span', { class: 'picker-year' }, String(year));
  const grid = h('div', { class: 'picker-grid', role: 'group', 'aria-label': '月を選ぶ' });

  const renderGrid = (): void => {
    clear(grid);
    yearLabel.textContent = String(year);
    for (const month of MONTHS) {
      const isCurrent = year === current.year && month === current.month;
      const isToday = year === today.year && month === today.month;
      const item = h(
        'button',
        {
          type: 'button',
          class: `picker-month${isToday ? ' is-today' : ''}`,
          'aria-pressed': isCurrent ? 'true' : 'false',
        },
        `${month}月`,
      );
      item.addEventListener('click', () => handlers.onSelect(year, month));
      grid.append(item);
    }
  };
  renderGrid();

  const step = (delta: number): void => {
    year += delta;
    renderGrid();
  };

  const prevYear = button('‹', () => step(-1), 'nav');
  prevYear.setAttribute('aria-label', '前の年');
  const nextYear = button('›', () => step(1), 'nav');
  nextYear.setAttribute('aria-label', '次の年');

  return h(
    'section',
    { class: 'picker', 'aria-label': '月の移動' },
    h('h2', { class: 'editor-title' }, '月を移動'),
    h('div', { class: 'picker-head' }, prevYear, yearLabel, nextYear),
    grid,
    h(
      'div',
      { class: 'editor-actions' },
      button('今日の月へ', () => handlers.onToday(), 'button button-primary'),
      button('閉じる', () => handlers.onClose(), 'button'),
    ),
  );
}
