/**
 * 決算月を基準にした反復（docs/SPEC.md §5.2 (e)）。
 *
 * 決算月を変えるだけで申告期限・期首・中間申告・四半期がまとめて追従することが
 * この仕組みの値打ちなので、決算月を差し替えたときの挙動を中心に固定する。
 */

import { describe, expect, it } from 'vitest';
import { createBusinessDayCalendar, DEFAULT_FISCAL_YEAR_END_MONTH } from '../src/core/businessDay';
import { describeRecurrence } from '../src/core/describe';
import { expandRecurrence, fiscalRelativeDate } from '../src/core/recurrence';
import { expandRules } from '../src/core/schedule';
import type { ScheduleContext } from '../src/core/schedule';
import { hasError, validateCalendar, validateRule } from '../src/core/validate';
import type { BusinessCalendar, Month, Recurrence } from '../src/types';
import { companyCalendarDef, holidays, makeRule } from './helpers';

function calendarWith(fiscalYearEndMonth: Month | undefined): BusinessCalendar {
  const base = { ...companyCalendarDef };
  if (fiscalYearEndMonth === undefined) delete base.fiscalYearEndMonth;
  else base.fiscalYearEndMonth = fiscalYearEndMonth;
  return base;
}

function contextFor(fiscalYearEndMonth: Month | undefined): ScheduleContext {
  const calendar = createBusinessDayCalendar(calendarWith(fiscalYearEndMonth), holidays);
  return { calendars: new Map([['company', calendar]]), fallbackCalendarId: 'company' };
}

function expand(recurrence: Recurrence, fiscal: Month | undefined, start: string, end: string): string[] {
  const ctx = contextFor(fiscal);
  const calendar = ctx.calendars.get('company');
  if (calendar === undefined) throw new Error('calendar');
  return expandRecurrence(recurrence, { start, end }, { calendar, anchor: null });
}

const filing: Recurrence = { type: 'fiscalRelative', offsetMonths: [2], day: 'last' };
const fiscalStart: Recurrence = { type: 'fiscalRelative', offsetMonths: [1], day: 1 };
const quarters: Recurrence = { type: 'fiscalRelative', offsetMonths: [-9, -6, -3, 0], day: 'last' };

describe('fiscalRelativeDate', () => {
  it('決算月からの月数で日付を出す', () => {
    expect(fiscalRelativeDate(2026, 3, 2, 'last')).toBe('2026-05-31');
    expect(fiscalRelativeDate(2026, 3, 1, 1)).toBe('2026-04-01');
    expect(fiscalRelativeDate(2026, 3, 8, 'last')).toBe('2026-11-30');
  });

  it('年をまたぐずれを扱える', () => {
    expect(fiscalRelativeDate(2026, 12, 2, 'last')).toBe('2027-02-28');
    expect(fiscalRelativeDate(2027, 12, 2, 'last')).toBe('2028-02-29');
    expect(fiscalRelativeDate(2026, 3, -3, 'last')).toBe('2025-12-31');
  });

  it('存在しない日は末日に丸める', () => {
    expect(fiscalRelativeDate(2026, 12, 2, 31)).toBe('2027-02-28');
    expect(fiscalRelativeDate(2026, 3, 1, 31)).toBe('2026-04-30');
  });
});

describe('決算月を変えると日付が動く', () => {
  it('申告期限（決算月の2か月後の末日）', () => {
    expect(expand(filing, 3, '2026-01-01', '2027-12-31')).toEqual(['2026-05-31', '2027-05-31']);
    expect(expand(filing, 12, '2026-01-01', '2028-12-31')).toEqual([
      '2026-02-28', '2027-02-28', '2028-02-29',
    ]);
    expect(expand(filing, 9, '2026-01-01', '2026-12-31')).toEqual(['2026-11-30']);
  });

  it('期首（決算月の翌月1日）', () => {
    expect(expand(fiscalStart, 3, '2026-01-01', '2027-12-31')).toEqual(['2026-04-01', '2027-04-01']);
    expect(expand(fiscalStart, 9, '2026-01-01', '2027-12-31')).toEqual(['2026-10-01', '2027-10-01']);
  });

  it('四半期末は決算月に合わせてずれる', () => {
    expect(expand(quarters, 3, '2026-01-01', '2026-12-31')).toEqual([
      '2026-03-31', '2026-06-30', '2026-09-30', '2026-12-31',
    ]);
    expect(expand(quarters, 12, '2026-01-01', '2026-12-31')).toEqual([
      '2026-03-31', '2026-06-30', '2026-09-30', '2026-12-31',
    ]);
    // 2月決算なら 2・5・8・11月末になる。
    expect(expand(quarters, 2, '2026-01-01', '2026-12-31')).toEqual([
      '2026-02-28', '2026-05-31', '2026-08-31', '2026-11-30',
    ]);
  });

  it('決算月が未設定なら3月として扱う', () => {
    expect(DEFAULT_FISCAL_YEAR_END_MONTH).toBe(3);
    expect(expand(filing, undefined, '2026-01-01', '2026-12-31')).toEqual(['2026-05-31']);
  });
});

describe('営業日補正との組み合わせ', () => {
  it('申告期限が休業日なら翌営業日へ送る', () => {
    // 12月決算の申告期限 2026-02-28 は土曜。翌営業日は 03-02(月)。
    const rule = makeRule({
      id: 'filing',
      title: '法人税の申告',
      recurrence: filing,
      adjust: { mode: 'next', keepInMonth: false },
    });
    const { occurrences } = expandRules(
      [rule],
      { start: '2026-01-01', end: '2026-12-31' },
      contextFor(12),
    );
    expect(occurrences.map((o) => [o.rawDate, o.date, o.shiftDirection])).toEqual([
      ['2026-02-28', '2026-03-02', 'next'],
    ]);
  });

  it('決算月を変えると補正結果も追従する', () => {
    const rule = makeRule({
      id: 'filing',
      title: '法人税の申告',
      recurrence: filing,
      adjust: { mode: 'next', keepInMonth: false },
    });
    const dates = (fiscal: Month): string[] =>
      expandRules([rule], { start: '2026-01-01', end: '2026-12-31' }, contextFor(fiscal))
        .occurrences.map((o) => o.date);
    // 3月決算 → 5/31(日) → 6/1(月)
    expect(dates(3)).toEqual(['2026-06-01']);
    expect(dates(12)).toEqual(['2026-03-02']);
  });
});

describe('説明文', () => {
  it('決算月からのずれを日本語にする', () => {
    expect(describeRecurrence(filing)).toBe('決算月の2か月後の末日');
    expect(describeRecurrence(fiscalStart)).toBe('決算月の1か月後の1日');
    expect(describeRecurrence({ type: 'fiscalRelative', offsetMonths: [0], day: 'last' })).toBe(
      '決算月の末日',
    );
    expect(describeRecurrence(quarters)).toBe(
      '決算月の9か月前・決算月の6か月前・決算月の3か月前・決算月の末日',
    );
    expect(describeRecurrence({ type: 'fiscalRelative', offsetMonths: [], day: 'last' })).toBe(
      '決算月からのずれ未設定',
    );
  });
});

describe('検証', () => {
  it('ずれが空ならエラー', () => {
    const issues = validateRule(
      makeRule({ title: 'x', recurrence: { type: 'fiscalRelative', offsetMonths: [], day: 'last' } }),
    );
    expect(issues.map((i) => i.path)).toContain('recurrence.offsetMonths');
  });

  it('ずれが大きすぎるとエラー', () => {
    const issues = validateRule(
      makeRule({ title: 'x', recurrence: { type: 'fiscalRelative', offsetMonths: [30], day: 'last' } }),
    );
    expect(issues.map((i) => i.path)).toContain('recurrence.offsetMonths');
  });

  it('日が範囲外ならエラー', () => {
    const issues = validateRule(
      makeRule({ title: 'x', recurrence: { type: 'fiscalRelative', offsetMonths: [0], day: 32 } }),
    );
    expect(issues.map((i) => i.path)).toContain('recurrence.day');
  });

  it('妥当なら問題なし', () => {
    expect(validateRule(makeRule({ title: '申告', recurrence: filing }))).toEqual([]);
  });

  it('決算月が範囲外のカレンダーはエラー', () => {
    expect(hasError(validateCalendar({ ...companyCalendarDef, fiscalYearEndMonth: 13 as Month }))).toBe(true);
    expect(hasError(validateCalendar(calendarWith(9)))).toBe(false);
    expect(hasError(validateCalendar(calendarWith(undefined)))).toBe(false);
  });
});
