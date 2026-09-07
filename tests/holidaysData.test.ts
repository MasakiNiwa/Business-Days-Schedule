/**
 * 同梱する src/data/holidays.json 自体の健全性検査（docs/SPEC.md §3.3）。
 *
 * このデータはビルドでアプリ本体へ埋め込まれ、実行時には一切検証されない。
 * 壊れたデータをそのまま公開してしまう事故は、ここで止めるしかない。
 */

import { describe, expect, it } from 'vitest';
import data from '../src/data/holidays.json' with { type: 'json' };
import { YEARS_AHEAD, YEARS_BACK, validatePublishedHolidays } from '../scripts/build-holidays';
import { isValidDateStr, todayInTokyo, yearOf } from '../src/core/dateUtil';
import { createHolidayLookup } from '../src/core/holidays';
import type { HolidayData } from '../src/types';

const parsed = data as HolidayData;
const dates = Object.keys(parsed.holidays);
const thisYear = yearOf(todayInTokyo());

describe('src/data/holidays.json', () => {
  it('公開前の検査を通る', () => {
    expect(() => validatePublishedHolidays(parsed, thisYear)).not.toThrow();
  });

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

  it('必要な年数だけを持ち、余計な年を同梱していない', () => {
    // 同梱データはアプリ本体の大きさに直結するので、実務で使う幅に絞る。
    // 生成時点の年が基準なので、生成から時間が経つと今年より前へずれていく。
    const from = yearOf(parsed.meta.range.from);
    const to = yearOf(parsed.meta.range.to);
    expect(to - from).toBe(YEARS_BACK + YEARS_AHEAD);
    expect(from).toBeLessThanOrEqual(thisYear);
    expect(to).toBeGreaterThanOrEqual(thisYear + 1);
  });

  it('今年と来年をカバーしている', () => {
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
