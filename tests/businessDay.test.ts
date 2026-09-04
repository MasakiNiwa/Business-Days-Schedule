import { describe, expect, it } from 'vitest';
import { createBusinessDayCalendar } from '../src/core/businessDay';
import { companyCalendar, companyCalendarDef, holidays, makeCalendar, plainCalendar } from './helpers';

describe('判定の優先順位 (docs/SPEC.md §4.2)', () => {
  it('openDates は祝日・週末より優先される', () => {
    const calendar = makeCalendar({ openDates: ['2026-09-21', '2026-09-19'] });
    expect(calendar.isBusinessDay('2026-09-21')).toBe(true); // 敬老の日
    expect(calendar.isBusinessDay('2026-09-19')).toBe(true); // 土曜
    expect(companyCalendar.isBusinessDay('2026-09-21')).toBe(false);
  });

  it('openDates は年末年始休業や臨時休業より優先される', () => {
    const calendar = makeCalendar({
      closedDates: ['2026-06-15'],
      openDates: ['2026-06-15', '2026-12-30'],
    });
    expect(calendar.isBusinessDay('2026-06-15')).toBe(true);
    expect(calendar.isBusinessDay('2026-12-30')).toBe(true);
  });

  it('休業理由を区別して返す', () => {
    expect(companyCalendar.closedReason('2026-09-04')).toBeNull(); // 金曜・平日
    expect(companyCalendar.closedReason('2026-09-05')).toEqual({ kind: 'weekend' });
    expect(companyCalendar.closedReason('2026-09-21')).toEqual({
      kind: 'holiday',
      label: '敬老の日',
    });
    expect(companyCalendar.closedReason('2026-12-30')).toEqual({
      kind: 'closedRange',
      label: '年末年始休業',
    });
    expect(makeCalendar({ closedDates: ['2026-06-15'] }).closedReason('2026-06-15')).toEqual({
      kind: 'closedDate',
    });
  });

  it('useNationalHolidays が false なら祝日でも営業日', () => {
    const calendar = makeCalendar({ useNationalHolidays: false, closedRanges: [] });
    expect(calendar.isBusinessDay('2026-09-21')).toBe(true);
    expect(calendar.isBusinessDay('2026-09-20')).toBe(false); // 日曜は休業のまま
  });

  it('weekendDays を変えれば土曜出勤にできる', () => {
    const calendar = makeCalendar({ weekendDays: [0] });
    expect(calendar.isBusinessDay('2026-09-19')).toBe(true); // 土
    expect(calendar.isBusinessDay('2026-09-20')).toBe(false); // 日
  });
});

describe('closedRanges の年跨ぎ', () => {
  it('12-29 〜 01-03 が年をまたいで休業になる', () => {
    for (const date of ['2025-12-29', '2025-12-31', '2026-01-01', '2026-01-03']) {
      expect(companyCalendar.isBusinessDay(date)).toBe(false);
    }
    expect(companyCalendar.isBusinessDay('2025-12-26')).toBe(true);
    expect(companyCalendar.isBusinessDay('2026-01-05')).toBe(true);
  });

  it('年をまたがない範囲は通常どおり閉区間で判定する', () => {
    const calendar = makeCalendar({
      closedRanges: [{ from: '08-13', to: '08-15', label: '夏季休業' }],
    });
    expect(calendar.isBusinessDay('2026-08-12')).toBe(true);
    expect(calendar.isBusinessDay('2026-08-13')).toBe(false);
    expect(calendar.isBusinessDay('2026-08-14')).toBe(false);
    expect(calendar.isBusinessDay('2026-08-17')).toBe(true);
  });
});

describe('前後の営業日', () => {
  it('連休をまたいで探索する', () => {
    // 2026-09-19(土) 〜 09-23(水) は5連休
    expect(companyCalendar.nextBusinessDay('2026-09-18')).toBe('2026-09-24');
    expect(companyCalendar.prevBusinessDay('2026-09-24')).toBe('2026-09-18');
    // 年末年始休業をまたぐ
    expect(companyCalendar.nextBusinessDay('2025-12-26')).toBe('2026-01-05');
  });

  it('snap は営業日ならその日を返す', () => {
    expect(companyCalendar.snap('2026-09-18', 'prev')).toBe('2026-09-18');
    expect(companyCalendar.snap('2026-09-21', 'prev')).toBe('2026-09-18');
    expect(companyCalendar.snap('2026-09-21', 'next')).toBe('2026-09-24');
  });

  it('営業日が見つからなければ null', () => {
    const alwaysClosed = createBusinessDayCalendar(
      { ...companyCalendarDef, weekendDays: [0, 1, 2, 3, 4, 5, 6] },
      holidays,
    );
    expect(alwaysClosed.nextBusinessDay('2026-09-01')).toBeNull();
    expect(alwaysClosed.snap('2026-09-01', 'prev')).toBeNull();
  });
});

describe('addBusinessDays', () => {
  it('0 なら同じ日を返す', () => {
    expect(companyCalendar.addBusinessDays('2026-09-21', 0)).toBe('2026-09-21');
  });

  it('休業日をスキップして数える', () => {
    expect(companyCalendar.addBusinessDays('2026-09-24', -1)).toBe('2026-09-18');
    expect(companyCalendar.addBusinessDays('2026-09-24', -3)).toBe('2026-09-16');
    expect(companyCalendar.addBusinessDays('2026-09-18', 1)).toBe('2026-09-24');
  });
});

describe('businessDaysOfMonth / nthBusinessDayOfMonth', () => {
  it('年末年始休業の有無で1月の営業日が変わる', () => {
    expect(companyCalendar.nthBusinessDayOfMonth(2026, 1, 1)).toBe('2026-01-05');
    expect(plainCalendar.nthBusinessDayOfMonth(2026, 1, 1)).toBe('2026-01-02');
    expect(companyCalendar.businessDaysOfMonth(2026, 1)).toHaveLength(19);
  });

  it('負の値は月末起点で数える', () => {
    expect(companyCalendar.nthBusinessDayOfMonth(2026, 9, -1)).toBe('2026-09-30');
    expect(companyCalendar.nthBusinessDayOfMonth(2026, 9, -2)).toBe('2026-09-29');
    expect(companyCalendar.nthBusinessDayOfMonth(2026, 12, -1)).toBe('2026-12-28');
  });

  it('営業日数が足りない月は null', () => {
    expect(companyCalendar.nthBusinessDayOfMonth(2026, 9, 5)).toBe('2026-09-07');
    expect(companyCalendar.nthBusinessDayOfMonth(2026, 9, 99)).toBeNull();
    expect(companyCalendar.nthBusinessDayOfMonth(2026, 9, -99)).toBeNull();
    expect(companyCalendar.nthBusinessDayOfMonth(2026, 9, 0)).toBeNull();
  });
});
