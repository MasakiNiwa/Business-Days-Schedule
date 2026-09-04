import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  compareDate,
  diffDays,
  diffMonths,
  eachMonth,
  isLeapYear,
  isValidDateStr,
  isWithin,
  lastDateOfMonth,
  lastDayOfMonth,
  makeDate,
  monthKeyOf,
  parseDate,
  todayInTokyo,
  weekdayOf,
} from '../src/core/dateUtil';

describe('isValidDateStr', () => {
  it('実在する日付だけを受け付ける', () => {
    expect(isValidDateStr('2026-01-01')).toBe(true);
    expect(isValidDateStr('2024-02-29')).toBe(true);
    expect(isValidDateStr('2026-02-29')).toBe(false);
    expect(isValidDateStr('2026-13-01')).toBe(false);
    expect(isValidDateStr('2026-1-1')).toBe(false);
    expect(isValidDateStr('')).toBe(false);
  });
});

describe('parseDate', () => {
  it('存在しない日付は例外にする', () => {
    expect(() => parseDate('2026-02-30')).toThrow(RangeError);
    expect(() => parseDate('2026/01/01')).toThrow(RangeError);
  });
});

describe('addDays / diffDays', () => {
  it('月・年をまたいで正しく加減できる', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-01-01', '2026-12-31')).toBe(364);
    expect(diffDays('2026-03-01', '2026-02-28')).toBe(-1);
  });
});

describe('weekdayOf', () => {
  it('曜日を返す (0=日)', () => {
    expect(weekdayOf('2026-09-04')).toBe(5); // 金
    expect(weekdayOf('2026-08-01')).toBe(6); // 土
    expect(weekdayOf('2026-04-06')).toBe(1); // 月
  });
});

describe('うるう年と月末', () => {
  it('判定と末日が一致する', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(lastDayOfMonth(2024, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDateOfMonth(2026, 4)).toBe('2026-04-30');
  });
});

describe('addMonths', () => {
  it('加算先の末日に丸める', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
    expect(diffMonths('2026-01-15', '2026-04-01')).toBe(3);
    expect(diffMonths('2026-01-15', '2025-11-01')).toBe(-2);
  });
});

describe('makeDate', () => {
  it('桁あふれを正規化する', () => {
    expect(makeDate(2026, 13, 1)).toBe('2027-01-01');
    expect(makeDate(2026, 1, 0)).toBe('2025-12-31');
  });
});

describe('eachMonth', () => {
  it('年をまたいで月を列挙する', () => {
    expect(eachMonth('2026-11-15', '2027-02-01')).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 },
    ]);
  });
});

describe('その他', () => {
  it('monthKeyOf / compareDate / isWithin', () => {
    expect(monthKeyOf('2026-07-05')).toBe('2026-07');
    expect(compareDate('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDate('2026-01-02', '2026-01-02')).toBe(0);
    expect(isWithin('2026-05-01', '2026-01-01', null)).toBe(true);
    expect(isWithin('2025-12-31', '2026-01-01', null)).toBe(false);
    expect(isWithin('2026-05-01', null, '2026-04-30')).toBe(false);
  });

  it('todayInTokyo は UTC 深夜でも日本の日付を返す', () => {
    // 2026-09-04T16:00Z = 2026-09-05 01:00 JST
    expect(todayInTokyo(new Date('2026-09-04T16:00:00Z'))).toBe('2026-09-05');
    expect(todayInTokyo(new Date('2026-09-04T14:59:59Z'))).toBe('2026-09-04');
  });
});
