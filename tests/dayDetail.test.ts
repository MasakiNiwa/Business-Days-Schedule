/**
 * @vitest-environment jsdom
 *
 * 日付の詳細パネル。1日に予定が集中したときの受け皿なので、
 * 省略せず全件出ること・補正の由来が読めることを固定する。
 */

import { describe, expect, it, vi } from 'vitest';
import { expandRules, groupByDate } from '../src/core/schedule';
import { renderDayDetail } from '../src/ui/DayDetail';
import type { DayDetailHandlers } from '../src/ui/DayDetail';
import type { BusinessCalendar, Occurrence, Rule } from '../src/types';
import { companyCalendar, companyCalendarDef, holidays, makeRule, scheduleContext } from './helpers';

const calendars = new Map<string, BusinessCalendar>([['company', companyCalendarDef]]);

function open(
  date: string,
  rules: Rule[],
  handlers: Partial<DayDetailHandlers> = {},
): { element: HTMLElement; handlers: DayDetailHandlers; occurrences: Occurrence[] } {
  const full: DayDetailHandlers = {
    onClose: vi.fn(),
    onEditRule: vi.fn(),
    onMove: vi.fn(),
    ...handlers,
  };
  const { occurrences } = expandRules(
    rules,
    { start: `${date.slice(0, 7)}-01`, end: `${date.slice(0, 7)}-28` },
    scheduleContext,
  );
  const forDay = groupByDate(occurrences).get(date) ?? [];
  const element = renderDayDetail(
    date,
    forDay,
    new Map(rules.map((rule) => [rule.id, rule])),
    calendars,
    companyCalendar,
    holidays,
    full,
  );
  return { element, handlers: full, occurrences: forDay };
}

const salary = makeRule({
  id: 'salary',
  title: '給与振込',
  calendarId: 'company',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
  notices: [{ offset: -3, unit: 'business', label: '振込データ作成' }],
});

describe('renderDayDetail', () => {
  it('日付と曜日、営業日かどうかを出す', () => {
    const { element } = open('2026-09-04', []);
    expect(element.querySelector('.editor-title')?.textContent).toBe('2026-09-04（金）');
    expect(element.querySelector('.day-status')?.textContent).toContain('営業日');
  });

  it('休業理由と祝日名を出す', () => {
    const { element } = open('2026-09-21', []);
    expect(element.querySelector('.day-status')?.textContent).toContain('休業日（敬老の日）');
    expect(element.querySelector('.day-holiday')?.textContent).toBe('敬老の日');
  });

  it('週末と年末年始休業を区別する', () => {
    expect(open('2026-09-05', []).element.querySelector('.day-status')?.textContent).toContain(
      '休業日（週末）',
    );
    expect(open('2026-12-30', []).element.querySelector('.day-status')?.textContent).toContain(
      '休業日（年末年始休業）',
    );
  });

  it('予定が無ければその旨を出す', () => {
    const { element } = open('2026-09-08', [salary]);
    expect(element.querySelector('.day-items')).toBeNull();
    expect(element.textContent).toContain('この日の予定はありません');
  });

  it('補正の由来を文章で出す', () => {
    // 2026-04-25(土) → 04-24(金)
    const { element } = open('2026-04-24', [salary]);
    expect(element.querySelector('.day-item-origin')?.textContent).toBe(
      '本来は 2026-04-25（休業日）。前営業日へ前倒し。',
    );
    expect(element.querySelector('.day-item-desc')?.textContent).toContain('毎月25日');
    expect(element.querySelector('.day-item-desc')?.textContent).toContain('自社カレンダー');
  });

  it('準備日も由来を出す', () => {
    // 04-24 の3営業日前 = 04-21
    const { element } = open('2026-04-21', [salary]);
    const item = element.querySelector('.day-item.is-notice');
    expect(item?.querySelector('.day-item-title')?.textContent).toBe('給与振込: 振込データ作成');
    expect(item?.querySelector('.day-item-origin')?.textContent).toContain(
      '2026-04-24 の予定に対する準備日',
    );
  });

  it('チップの上限を超える件数でも全件出す', () => {
    const rules = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      makeRule({
        id,
        title: `予定${id}`,
        recurrence: { type: 'monthlyByDay', interval: 1, days: [15], overflow: 'clamp' },
        adjust: { mode: 'none', keepInMonth: false },
      }),
    );
    const { element } = open('2026-09-15', rules);
    expect(element.querySelectorAll('.day-item')).toHaveLength(5);
  });

  it('編集・前後移動・閉じるを呼べる', () => {
    const { element, handlers } = open('2026-04-24', [salary]);
    const click = (text: string): void => {
      [...element.querySelectorAll('button')]
        .find((b) => b.textContent === text)
        ?.dispatchEvent(new MouseEvent('click'));
    };
    click('編集');
    click('‹ 前日');
    click('翌日 ›');
    click('閉じる');
    expect(handlers.onEditRule).toHaveBeenCalledWith('salary');
    expect(vi.mocked(handlers.onMove).mock.calls).toEqual([[-1], [1]]);
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it('ルール名の HTML はエスケープされる', () => {
    const evil = makeRule({ ...salary, id: 'evil', title: '<img src=x onerror=alert(1)>' });
    const { element } = open('2026-04-24', [evil]);
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('.day-item-title')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
