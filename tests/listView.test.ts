/**
 * @vitest-environment jsdom
 *
 * 一覧表示（docs/SPEC.md §8.3）。
 * 時系列で並ぶこと、同じ日の予定がひとかたまりに見えること、
 * 補正の由来が読めることを固定する。
 */

import { describe, expect, it, vi } from 'vitest';
import { addDays } from '../src/core/dateUtil';
import { expandRules } from '../src/core/schedule';
import { LIST_RANGES, renderList } from '../src/ui/ListView';
import type { ListHandlers } from '../src/ui/ListView';
import type { BusinessCalendar, Rule } from '../src/types';
import { bankCalendarDef, companyCalendar, companyCalendarDef, holidays, makeRule, scheduleContext } from './helpers';

const TODAY = '2026-09-05';
const calendars = new Map<string, BusinessCalendar>([
  ['company', companyCalendarDef],
  ['bank', bankCalendarDef],
]);

function open(
  rules: Rule[],
  days = 90,
  handlers: Partial<ListHandlers> = {},
): { element: HTMLElement; handlers: ListHandlers } {
  const full: ListHandlers = { onEditRule: vi.fn(), onSelectDay: vi.fn(), ...handlers };
  const { occurrences } = expandRules(
    rules,
    { start: TODAY, end: addDays(TODAY, days - 1) },
    scheduleContext,
  );
  const element = renderList(
    occurrences,
    new Map(rules.map((rule) => [rule.id, rule])),
    calendars,
    companyCalendar,
    holidays,
    TODAY,
    days,
    TODAY,
    full,
  );
  return { element, handlers: full };
}

const salary = makeRule({
  id: 'salary',
  title: '給与振込',
  calendarId: 'bank',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
});
const closing = makeRule({
  id: 'closing',
  title: '月次締め',
  color: 'green',
  recurrence: { type: 'monthlyByDay', interval: 1, days: ['last'], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
});

const textsOf = (root: ParentNode, selector: string): string[] =>
  [...root.querySelectorAll(selector)].map((node) => node.textContent ?? '');

describe('renderList', () => {
  it('日付の昇順で並べる', () => {
    const { element } = open([salary, closing], 90);
    const dates = textsOf(element, '.list-date-button').filter((text) => text !== '');
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe('2026-09-25');
  });

  it('見出しと件数を出す', () => {
    const { element } = open([salary], 90);
    expect(textsOf(element, '.list th')).toEqual(['日付', '曜日', '予定', '補正', '内容']);
    expect(element.querySelector('.list-summary')?.textContent).toContain('2026-09-05 〜 2026-12-03');
  });

  it('同じ日の2件目は日付と曜日を繰り返さない', () => {
    // 2026-09-30(水) に月次締め、給与振込は 09-25。別日なのでどちらも先頭行になる。
    // 同日に集まる例として、末日ルールを2本用意する。
    const another = makeRule({ ...closing, id: 'another', title: '在庫棚卸' });
    const { element } = open([closing, another], 40);
    const rows = [...element.querySelectorAll('.list-row')];
    const sameDay = rows.filter((row) =>
      (row.querySelector('.list-date-button')?.textContent ?? '') === '2026-09-30',
    );
    expect(sameDay).toHaveLength(1);
    expect(rows[0]?.className).toContain('is-group-start');
    expect(rows[1]?.className).not.toContain('is-group-start');
    expect(rows[1]?.querySelector('.list-date-button')?.textContent).toBe('');
  });

  it('補正の向きと元の日を出す', () => {
    const { element } = open([salary], 90);
    // 2026-10-25(日) → 10-23(金)
    const row = [...element.querySelectorAll('.list-row')].find(
      (node) => node.querySelector('.list-date-button')?.textContent === '2026-10-23',
    );
    expect(row?.querySelector('.list-shift')?.textContent).toBe('←25');
  });

  it('祝日名と曜日を出す', () => {
    const holiday = makeRule({
      id: 'h',
      title: '祝日の予定',
      recurrence: { type: 'monthlyByDay', interval: 1, months: [9], days: [21], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
    });
    const { element } = open([holiday], 30);
    const cell = element.querySelector('.list-weekday');
    expect(cell?.textContent).toContain('月');
    expect(cell?.querySelector('.list-holiday')?.textContent).toBe('敬老の日');
    expect(cell?.className).toContain('is-red');
  });

  it('事前通知は由来を出す', () => {
    const withNotice = makeRule({
      ...salary,
      notices: [{ offset: -3, unit: 'business', label: '振込データ作成' }],
    });
    const { element } = open([withNotice], 30);
    const notice = element.querySelector('.is-notice-title');
    expect(notice?.textContent).toBe('給与振込: 振込データ作成');
    expect(element.querySelector('.list-notice-origin')?.textContent).toBe('2026-09-25 の準備');
  });

  it('今日の行に印を付ける', () => {
    const todayRule = makeRule({
      id: 'today',
      title: '今日の予定',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [5], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
    });
    const { element } = open([todayRule], 30);
    expect(element.querySelectorAll('.list-row.is-today')).toHaveLength(1);
  });

  it('予定が無ければその旨を出す', () => {
    const { element } = open([], 30);
    expect(element.querySelector('.list')).toBeNull();
    expect(element.textContent).toContain('該当する予定はありません');
  });

  it('日付からは詳細、予定名からは編集を呼べる', () => {
    const { element, handlers } = open([salary], 30);
    element.querySelector<HTMLButtonElement>('.list-date-button')?.dispatchEvent(new MouseEvent('click'));
    element.querySelector<HTMLButtonElement>('.list-title-button')?.dispatchEvent(new MouseEvent('click'));
    expect(handlers.onSelectDay).toHaveBeenCalledWith('2026-09-25');
    expect(handlers.onEditRule).toHaveBeenCalledWith('salary');
  });

  it('ルール名の HTML はエスケープされる', () => {
    const evil = makeRule({ ...salary, id: 'evil', title: '<img src=x onerror=alert(1)>' });
    const { element } = open([evil], 30);
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('.list-title-button')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('先読み日数の選択肢を持つ', () => {
    expect(LIST_RANGES).toEqual([30, 90, 180, 365]);
  });
});
