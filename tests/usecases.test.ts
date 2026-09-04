/**
 * docs/SPEC.md §6 の実務ユースケース対応表を、そのまま回帰テストにしたもの。
 * 「16件すべてが1ルールで表現できる」という仕様上の主張をここで担保する。
 */

import { describe, expect, it } from 'vitest';
import { expandRules } from '../src/core/schedule';
import type { Occurrence, Rule } from '../src/types';
import { makeRule, scheduleContext } from './helpers';

const YEAR_2026 = { start: '2026-01-01', end: '2026-12-31' };

function run(rule: Rule, range = YEAR_2026): Occurrence[] {
  return expandRules([rule], range, scheduleContext).occurrences;
}

const mainDates = (rule: Rule, range = YEAR_2026): string[] =>
  run(rule, range)
    .filter((o) => o.kind === 'main')
    .map((o) => o.date);

describe('§6 実務ユースケース対応表', () => {
  it('1. 給与振込: 毎月25日、休日なら前営業日（銀行カレンダー）', () => {
    const rule = makeRule({
      title: '給与振込',
      calendarId: 'bank',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
    });
    expect(mainDates(rule)).toEqual([
      '2026-01-23', '2026-02-25', '2026-03-25', '2026-04-24',
      '2026-05-25', '2026-06-25', '2026-07-24', '2026-08-25',
      '2026-09-25', '2026-10-23', '2026-11-25', '2026-12-25',
    ]);
  });

  it('2. 月次締め: 月末営業日', () => {
    const rule = makeRule({
      title: '月次締め',
      recurrence: { type: 'monthlyByDay', interval: 1, days: ['last'], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
    });
    expect(mainDates(rule)).toEqual([
      '2026-01-30', '2026-02-27', '2026-03-31', '2026-04-30',
      '2026-05-29', '2026-06-30', '2026-07-31', '2026-08-31',
      '2026-09-30', '2026-10-30', '2026-11-30', '2026-12-28',
    ]);
  });

  it('3. 源泉所得税納付: 毎月10日、休日なら翌営業日', () => {
    const rule = makeRule({
      title: '源泉所得税納付',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
      adjust: { mode: 'next', keepInMonth: false },
    });
    expect(mainDates(rule)).toEqual([
      '2026-01-13', '2026-02-10', '2026-03-10', '2026-04-10',
      '2026-05-11', '2026-06-10', '2026-07-10', '2026-08-10',
      '2026-09-10', '2026-10-13', '2026-11-10', '2026-12-10',
    ]);
  });

  it('4. 社会保険料引落: 毎月末日、休日なら翌営業日（翌月・翌年へ送られる）', () => {
    const rule = makeRule({
      title: '社会保険料引落',
      recurrence: { type: 'monthlyByDay', interval: 1, days: ['last'], overflow: 'clamp' },
      adjust: { mode: 'next', keepInMonth: false },
    });
    // 先頭の 2026-01-05 は前年 12/31 が年末年始休業を越えて送られてきたもの。
    // 末尾は 2026-11-30 まで（12/31 分は 2027-01-04 となり表示範囲外）。
    expect(mainDates(rule)).toEqual([
      '2026-01-05', '2026-02-02', '2026-03-02', '2026-03-31',
      '2026-04-30', '2026-06-01', '2026-06-30', '2026-07-31',
      '2026-08-31', '2026-09-30', '2026-11-02', '2026-11-30',
    ]);
  });

  it('5. 請求書発行: 毎月第5営業日', () => {
    const rule = makeRule({
      title: '請求書発行',
      recurrence: { type: 'monthlyByBusinessDay', interval: 1, nth: [5] },
      adjust: { mode: 'none', keepInMonth: false },
    });
    expect(mainDates(rule)).toEqual([
      '2026-01-09', '2026-02-06', '2026-03-06', '2026-04-07',
      '2026-05-12', '2026-06-05', '2026-07-07', '2026-08-07',
      '2026-09-07', '2026-10-07', '2026-11-09', '2026-12-07',
    ]);
  });

  it('6. 支払処理: 月末2営業日前', () => {
    const rule = makeRule({
      title: '支払処理',
      recurrence: { type: 'monthlyByBusinessDay', interval: 1, nth: [-2] },
      adjust: { mode: 'none', keepInMonth: false },
    });
    expect(mainDates(rule)).toEqual([
      '2026-01-29', '2026-02-26', '2026-03-30', '2026-04-28',
      '2026-05-28', '2026-06-29', '2026-07-30', '2026-08-28',
      '2026-09-29', '2026-10-29', '2026-11-27', '2026-12-25',
    ]);
  });

  it('7. 定例会議: 第2・第4火曜', () => {
    const rule = makeRule({
      title: '定例会議',
      recurrence: { type: 'monthlyByWeekday', interval: 1, nth: [2, 4], weekday: 2 },
      adjust: { mode: 'none', keepInMonth: false },
    });
    expect(mainDates(rule, { start: '2026-01-01', end: '2026-03-31' })).toEqual([
      '2026-01-13', '2026-01-27',
      '2026-02-10', '2026-02-24',
      '2026-03-10', '2026-03-24',
    ]);
  });

  it('8. 部会: 毎月最終金曜', () => {
    const rule = makeRule({
      title: '部会',
      recurrence: { type: 'monthlyByWeekday', interval: 1, nth: [-1], weekday: 5 },
      adjust: { mode: 'none', keepInMonth: false },
    });
    expect(mainDates(rule)).toEqual([
      '2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24',
      '2026-05-29', '2026-06-26', '2026-07-31', '2026-08-28',
      '2026-09-25', '2026-10-30', '2026-11-27', '2026-12-25',
    ]);
  });

  it('9. 週次報告: 毎週金曜、休日なら前営業日', () => {
    const rule = makeRule({
      title: '週次報告',
      recurrence: { type: 'weekly', interval: 1, weekdays: [5] },
      adjust: { mode: 'prev', keepInMonth: false },
    });
    // 2027-01-01(金) は年末年始休業のため 2026-12-28(月) へ前倒しされる。
    expect(mainDates(rule, { start: '2026-12-01', end: '2027-01-31' })).toEqual([
      '2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25', '2026-12-28',
      '2027-01-08', '2027-01-15', '2027-01-22', '2027-01-29',
    ]);
  });

  it('10. 1on1: 隔週月曜', () => {
    const rule = makeRule({
      title: '1on1',
      recurrence: { type: 'weekly', interval: 2, weekdays: [1], anchor: '2026-04-06' },
      adjust: { mode: 'none', keepInMonth: false },
    });
    expect(mainDates(rule, { start: '2026-04-01', end: '2026-06-01' })).toEqual([
      '2026-04-06', '2026-04-20', '2026-05-04', '2026-05-18', '2026-06-01',
    ]);
  });

  it('11. 四半期報告: 3/6/9/12月の月末営業日', () => {
    const rule = makeRule({
      title: '四半期報告',
      recurrence: {
        type: 'monthlyByDay',
        interval: 1,
        months: [3, 6, 9, 12],
        days: ['last'],
        overflow: 'clamp',
      },
      adjust: { mode: 'prev', keepInMonth: false },
    });
    expect(mainDates(rule)).toEqual(['2026-03-31', '2026-06-30', '2026-09-30', '2026-12-28']);
  });

  it('12. 期首棚卸: 毎年4月1日、休日なら翌営業日', () => {
    const rule = makeRule({
      title: '期首棚卸',
      recurrence: { type: 'monthlyByDay', interval: 1, months: [4], days: [1], overflow: 'clamp' },
      adjust: { mode: 'next', keepInMonth: false },
    });
    expect(mainDates(rule, { start: '2026-01-01', end: '2028-12-31' })).toEqual([
      '2026-04-01', '2027-04-01', '2028-04-03',
    ]);
  });

  it('13. 給与と支払を1ルールで: 毎月10日と25日', () => {
    const rule = makeRule({
      title: '支払日',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [10, 25], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
    });
    expect(mainDates(rule, { start: '2026-01-01', end: '2026-03-31' })).toEqual([
      '2026-01-09', '2026-01-23',
      '2026-02-10', '2026-02-25',
      '2026-03-10', '2026-03-25',
    ]);
  });

  it('14. 決算: 3月末営業日の3営業日前から準備', () => {
    const rule = makeRule({
      title: '決算',
      recurrence: { type: 'monthlyByDay', interval: 1, months: [3], days: ['last'], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
      notices: [{ offset: -3, unit: 'business', label: '決算準備開始' }],
    });
    expect(run(rule).map((o) => [o.kind, o.date, o.noticeLabel])).toEqual([
      ['notice', '2026-03-26', '決算準備開始'],
      ['main', '2026-03-31', undefined],
    ]);
  });

  it('15. 年末年始休業は営業日カレンダーで表現する', () => {
    const calendar = scheduleContext.calendars.get('company');
    expect(calendar?.closedReason('2026-12-30')).toEqual({
      kind: 'closedRange',
      label: '年末年始休業',
    });
    expect(calendar?.isBusinessDay('2026-12-28')).toBe(true);
  });

  it('16. 今年の8月10日の締めだけ無しにする', () => {
    const base = makeRule({
      title: '締め',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
    });
    expect(mainDates(base, { start: '2026-07-01', end: '2026-09-30' })).toEqual([
      '2026-07-10', '2026-08-10', '2026-09-10',
    ]);
    const withSkip = makeRule({ ...base, skipDates: ['2026-08-10'] });
    expect(mainDates(withSkip, { start: '2026-07-01', end: '2026-09-30' })).toEqual([
      '2026-07-10', '2026-09-10',
    ]);
  });
});
