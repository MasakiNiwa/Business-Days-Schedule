/**
 * 配信する public/data/holidays.json 自体の健全性検査（docs/SPEC.md §3.3）。
 *
 * 祝日更新ワークフローはこのテストを通してから差分をコミットするため、
 * 取得や変換が壊れたデータをそのまま公開してしまう事故をここで止める。
 */

import { describe, expect, it } from 'vitest';
import data from '../public/data/holidays.json' with { type: 'json' };
import { isValidDateStr, todayInTokyo, yearOf } from '../src/core/dateUtil';
import { createHolidayLookup, parseHolidayData } from '../src/core/holidays';

const parsed = parseHolidayData(data);
const dates = Object.keys(parsed.holidays);
const thisYear = yearOf(todayInTokyo());

describe('public/data/holidays.json', () => {
  it('スキーマを満たす', () => {
    expect(parsed.meta.source).toBe('holiday-jp/holiday_jp');
    expect(parsed.meta.count).toBe(dates.length);
    expect(isValidDateStr(parsed.meta.range.from)).toBe(true);
    expect(isValidDateStr(parsed.meta.range.to)).toBe(true);
  });

  it('日付キーが実在し、昇順に並んでいる', () => {
    for (const date of dates) expect(isValidDateStr(date), date).toBe(true);
    expect(dates).toEqual([...dates].sort());
  });

  it('祝日名が空でない', () => {
    for (const [date, name] of Object.entries(parsed.holidays)) {
      expect(name.trim(), date).not.toBe('');
    }
  });

  it('収録範囲が実データを包含する', () => {
    const first = dates[0] ?? '';
    const last = dates[dates.length - 1] ?? '';
    expect(first).not.toBe('');
    expect(first >= parsed.meta.range.from).toBe(true);
    expect(last <= parsed.meta.range.to).toBe(true);
  });

  it('今年と来年をカバーしている', () => {
    expect(yearOf(parsed.meta.range.from)).toBeLessThanOrEqual(thisYear);
    expect(yearOf(parsed.meta.range.to)).toBeGreaterThanOrEqual(thisYear + 1);
    for (const year of [thisYear, thisYear + 1]) {
      const inYear = dates.filter((date) => yearOf(date) === year);
      // 祝日法上、通常の年は16日以上ある。極端に少ないのは取得漏れを疑う。
      expect(inYear.length, `${year}年`).toBeGreaterThanOrEqual(16);
    }
  });

  it('主要な祝日が含まれている', () => {
    const lookup = createHolidayLookup(parsed);
    for (const year of [thisYear, thisYear + 1]) {
      expect(lookup.nameOf(`${year}-01-01`), `${year}-01-01`).toBe('元日');
      expect(lookup.nameOf(`${year}-02-11`), `${year}-02-11`).toBe('建国記念の日');
      expect(lookup.nameOf(`${year}-11-03`), `${year}-11-03`).toBe('文化の日');
    }
  });

  it('振替休日・国民の休日を収録している', () => {
    const names = new Set(Object.values(parsed.holidays));
    expect([...names].some((name) => name.includes('振替休日'))).toBe(true);
    expect(names.has('休日')).toBe(true);
  });
});
