/**
 * 月カレンダーの格子を組み立てる（docs/SPEC.md §8.2）。
 *
 * 描画に必要な情報を1セルにまとめた純粋なデータ構造を返す。DOM に依存しないため、
 * 「前後の月がどこまで並ぶか」「休業理由が正しく載るか」をテストで固定できる。
 */

import type { BusinessDayCalendar, ClosedReason } from './businessDay';
import type { DateStr, Month, Occurrence, Weekday } from '../types';
import { addDays, lastDayOfMonth, makeDate, weekdayOf } from './dateUtil';
import type { HolidayLookup } from './holidays';

export type DayCell = {
  date: DateStr;
  day: number;
  /** 表示対象の月に属するか。前後の月の日は淡く描く。 */
  inMonth: boolean;
  weekday: Weekday;
  isToday: boolean;
  closedReason: ClosedReason | null;
  holidayName: string | null;
  occurrences: Occurrence[];
};

export type MonthGrid = {
  year: number;
  month: Month;
  /** 週の配列。各週は日曜始まりの7セル。 */
  weeks: DayCell[][];
  /** 格子が覆う実際の日付範囲（前後の月を含む）。 */
  range: { start: DateStr; end: DateStr };
};

export type MonthGridContext = {
  calendar: BusinessDayCalendar;
  holidays: HolidayLookup;
  /** 日付 → その日の発生一覧。 */
  occurrencesByDate: ReadonlyMap<DateStr, Occurrence[]>;
  today: DateStr;
};

/** 表示月を覆う「日曜始まり・土曜終わり」の範囲を求める。 */
export function gridRangeOf(year: number, month: Month): { start: DateStr; end: DateStr } {
  const first = makeDate(year, month, 1);
  const last = makeDate(year, month, lastDayOfMonth(year, month));
  return {
    start: addDays(first, -weekdayOf(first)),
    end: addDays(last, 6 - weekdayOf(last)),
  };
}

export function buildMonthGrid(year: number, month: Month, ctx: MonthGridContext): MonthGrid {
  const range = gridRangeOf(year, month);
  const weeks: DayCell[][] = [];
  let week: DayCell[] = [];

  for (let date = range.start; date <= range.end; date = addDays(date, 1)) {
    const monthOfDate = Number(date.slice(5, 7));
    week.push({
      date,
      day: Number(date.slice(8, 10)),
      inMonth: monthOfDate === month && Number(date.slice(0, 4)) === year,
      weekday: weekdayOf(date),
      isToday: date === ctx.today,
      closedReason: ctx.calendar.closedReason(date),
      holidayName: ctx.holidays.nameOf(date),
      occurrences: ctx.occurrencesByDate.get(date) ?? [],
    });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }

  return { year, month, weeks, range };
}

/** 表示月を count か月ぶん進める／戻す。 */
export function shiftMonth(
  year: number,
  month: Month,
  count: number,
): { year: number; month: Month } {
  const total = year * 12 + (month - 1) + count;
  return { year: Math.floor(total / 12), month: ((total % 12) + 1) as Month };
}
