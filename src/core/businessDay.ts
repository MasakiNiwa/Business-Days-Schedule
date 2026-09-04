/**
 * 営業日カレンダー。判定の優先順位は docs/SPEC.md §4.2 に従う。
 *
 *   1. openDates      → 営業日（最優先）
 *   2. closedDates    → 休業日
 *   3. closedRanges   → 休業日
 *   4. 祝日           → 休業日
 *   5. weekendDays    → 休業日
 *   6. それ以外       → 営業日
 */

import type { AnnualRange, BusinessCalendar, DateStr, Month, MonthDayStr } from '../types';
import { addDays, dayOf, lastDayOfMonth, makeDate, monthOf, weekdayOf } from './dateUtil';
import type { HolidayLookup } from './holidays';

/** 補正時に営業日を探す上限日数。これを超える場合は設定が破綻していると判断する。 */
export const MAX_SHIFT_DAYS = 31;

export type ClosedReason =
  | { kind: 'weekend' }
  | { kind: 'holiday'; label: string }
  | { kind: 'closedRange'; label: string }
  | { kind: 'closedDate' };

export type BusinessDayCalendar = {
  readonly id: string;
  readonly name: string;
  isBusinessDay(date: DateStr): boolean;
  /** 休業日ならその理由。営業日なら null。 */
  closedReason(date: DateStr): ClosedReason | null;
  /** date より後の最初の営業日。 */
  nextBusinessDay(date: DateStr): DateStr | null;
  /** date より前の最後の営業日。 */
  prevBusinessDay(date: DateStr): DateStr | null;
  /** date が営業日ならそのまま、そうでなければ指定方向の最初の営業日。 */
  snap(date: DateStr, direction: 'prev' | 'next'): DateStr | null;
  /** 営業日単位で日数を加減する。count が 0 なら date をそのまま返す。 */
  addBusinessDays(date: DateStr, count: number): DateStr | null;
  /** 当月の営業日を昇順で列挙する。 */
  businessDaysOfMonth(year: number, month: Month): DateStr[];
  /** 第N営業日。正 = 月初起点(1始まり)、負 = 月末起点(-1 が最終営業日)。無ければ null。 */
  nthBusinessDayOfMonth(year: number, month: Month, nth: number): DateStr | null;
};

const MONTH_DAY_PATTERN = /^(\d{2})-(\d{2})$/;

function parseMonthDay(value: MonthDayStr): { month: number; day: number } {
  const parts = MONTH_DAY_PATTERN.exec(value);
  if (!parts) throw new RangeError(`MM-DD 形式ではありません: ${value}`);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  // うるう年を通すため 2-29 は許容する。
  if (month < 1 || month > 12 || day < 1 || day > lastDayOfMonth(2024, month)) {
    throw new RangeError(`存在しない月日です: ${value}`);
  }
  return { month, day };
}

/**
 * 年をまたぐ期間（例 12-29 〜 01-03）に対応した月日レンジの判定。
 * from <= to なら通常の範囲、from > to なら年末側と年始側の和集合とみなす。
 */
function matchesAnnualRange(date: DateStr, range: AnnualRange): boolean {
  const from = parseMonthDay(range.from);
  const to = parseMonthDay(range.to);
  const month = monthOf(date);
  const day = dayOf(date);
  const value = month * 100 + day;
  const start = from.month * 100 + from.day;
  const end = to.month * 100 + to.day;
  return start <= end ? value >= start && value <= end : value >= start || value <= end;
}

export function createBusinessDayCalendar(
  calendar: BusinessCalendar,
  holidays: HolidayLookup,
): BusinessDayCalendar {
  const openDates = new Set(calendar.openDates);
  const closedDates = new Set(calendar.closedDates);
  const weekendDays = new Set<number>(calendar.weekendDays);
  // 同じ日を繰り返し判定するため（月の営業日列挙・営業日加算）結果をメモ化する。
  const cache = new Map<DateStr, ClosedReason | null>();

  function computeClosedReason(date: DateStr): ClosedReason | null {
    if (openDates.has(date)) return null;
    if (closedDates.has(date)) return { kind: 'closedDate' };
    for (const range of calendar.closedRanges) {
      if (matchesAnnualRange(date, range)) return { kind: 'closedRange', label: range.label };
    }
    if (calendar.useNationalHolidays) {
      const name = holidays.nameOf(date);
      if (name !== null) return { kind: 'holiday', label: name };
    }
    if (weekendDays.has(weekdayOf(date))) return { kind: 'weekend' };
    return null;
  }

  function closedReason(date: DateStr): ClosedReason | null {
    if (cache.has(date)) return cache.get(date) ?? null;
    const reason = computeClosedReason(date);
    cache.set(date, reason);
    return reason;
  }

  const isBusinessDay = (date: DateStr): boolean => closedReason(date) === null;

  /** step 方向へ最大 MAX_SHIFT_DAYS だけ進んで最初の営業日を探す。fromInclusive で当日を含めるか決める。 */
  function seek(date: DateStr, step: 1 | -1, fromInclusive: boolean): DateStr | null {
    let cursor = fromInclusive ? date : addDays(date, step);
    for (let i = 0; i < MAX_SHIFT_DAYS; i += 1) {
      if (isBusinessDay(cursor)) return cursor;
      cursor = addDays(cursor, step);
    }
    return null;
  }

  function businessDaysOfMonth(year: number, month: Month): DateStr[] {
    const days: DateStr[] = [];
    const last = lastDayOfMonth(year, month);
    for (let day = 1; day <= last; day += 1) {
      const date = makeDate(year, month, day);
      if (isBusinessDay(date)) days.push(date);
    }
    return days;
  }

  return {
    id: calendar.id,
    name: calendar.name,
    isBusinessDay,
    closedReason,
    nextBusinessDay: (date) => seek(date, 1, false),
    prevBusinessDay: (date) => seek(date, -1, false),
    snap: (date, direction) => seek(date, direction === 'next' ? 1 : -1, true),
    addBusinessDays: (date, count) => {
      if (count === 0) return date;
      const step = count > 0 ? 1 : -1;
      let cursor = date;
      for (let remaining = Math.abs(count); remaining > 0; remaining -= 1) {
        const next = seek(cursor, step, false);
        if (next === null) return null;
        cursor = next;
      }
      return cursor;
    },
    businessDaysOfMonth,
    nthBusinessDayOfMonth: (year, month, nth) => {
      if (nth === 0) return null;
      const days = businessDaysOfMonth(year, month);
      const index = nth > 0 ? nth - 1 : days.length + nth;
      return days[index] ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// プリセット (docs/SPEC.md §4.3)
// ---------------------------------------------------------------------------

export const COMPANY_CALENDAR_ID = 'company';
export const BANK_CALENDAR_ID = 'bank';

export function createDefaultCalendars(): BusinessCalendar[] {
  return [
    {
      id: COMPANY_CALENDAR_ID,
      name: '自社カレンダー',
      weekendDays: [0, 6],
      useNationalHolidays: true,
      closedRanges: [{ from: '12-29', to: '01-03', label: '年末年始休業' }],
      closedDates: [],
      openDates: [],
    },
    {
      id: BANK_CALENDAR_ID,
      name: '銀行休業日',
      weekendDays: [0, 6],
      useNationalHolidays: true,
      closedRanges: [{ from: '12-31', to: '01-03', label: '銀行休業' }],
      closedDates: [],
      openDates: [],
    },
  ];
}
