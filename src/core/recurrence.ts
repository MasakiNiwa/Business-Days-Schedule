/**
 * 反復条件の展開（docs/SPEC.md §5.2, §7.1 の手順1）。
 *
 * ここが返すのはすべて【基準日】であり、営業日補正は adjust.ts が別途行う。
 * ただし monthlyByBusinessDay だけは定義上すでに営業日なので、後段で補正しない
 * （二重補正を構造的に防ぐため、その旨は schedule.ts が判断する）。
 */

import type {
  DateRange,
  DateStr,
  FiscalRelativeRecurrence,
  Month,
  MonthlyByBusinessDayRecurrence,
  MonthlyByDayRecurrence,
  MonthlyByWeekdayRecurrence,
  Recurrence,
  WeeklyRecurrence,
  Weekday,
} from '../types';
import type { BusinessDayCalendar } from './businessDay';
import {
  addDays,
  diffDays,
  eachDate,
  eachMonth,
  lastDayOfMonth,
  makeDate,
  parseDate,
  weekdayOf,
} from './dateUtil';

/** interval >= 2 で anchor も period.start も無い場合の既定位相。1970-01-05 は月曜。 */
export const DEFAULT_ANCHOR: DateStr = '1970-01-05';

export type ExpandContext = {
  /** monthlyByBusinessDay の展開に必要。 */
  calendar: BusinessDayCalendar;
  /** interval >= 2 のときの位相基準。通常は rule.period.start。 */
  anchor: DateStr | null;
};

/** 負の被除数でも 0..divisor-1 を返す剰余。 */
function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function normalizeInterval(interval: number): number {
  return Number.isFinite(interval) && interval >= 1 ? Math.floor(interval) : 1;
}

/** months が未指定なら全月を対象とする。 */
function monthMatches(months: Month[] | undefined, month: Month): boolean {
  return months === undefined || months.length === 0 || months.includes(month);
}

// ---------------------------------------------------------------------------
// weekly
// ---------------------------------------------------------------------------

function expandWeekly(
  recurrence: WeeklyRecurrence,
  range: DateRange,
  anchorDate: DateStr,
): DateStr[] {
  const weekdays = new Set<Weekday>(recurrence.weekdays);
  if (weekdays.size === 0) return [];
  const interval = normalizeInterval(recurrence.interval);
  const anchor = recurrence.anchor ?? anchorDate;
  // 週の起点（日曜）に揃えてから週数を数える。曜日をまたいでも位相がずれない。
  const anchorWeekStart = addDays(anchor, -weekdayOf(anchor));

  const result: DateStr[] = [];
  for (const date of eachDate(range.start, range.end)) {
    const weekday = weekdayOf(date);
    if (!weekdays.has(weekday)) continue;
    if (interval > 1) {
      const weekStart = addDays(date, -weekday);
      const weekIndex = Math.round(diffDays(anchorWeekStart, weekStart) / 7);
      if (mod(weekIndex, interval) !== 0) continue;
    }
    result.push(date);
  }
  return result;
}

// ---------------------------------------------------------------------------
// monthly 系の共通処理
// ---------------------------------------------------------------------------

/** interval >= 2 のとき、anchor の月から数えて位相が合う月だけを通す。 */
function monthPhaseMatches(
  interval: number,
  anchorDate: DateStr,
  year: number,
  month: Month,
): boolean {
  if (interval <= 1) return true;
  const anchor = parseDate(anchorDate);
  const monthsFromAnchor = (year - anchor.year) * 12 + (month - anchor.month);
  return mod(monthsFromAnchor, interval) === 0;
}

function targetMonths(
  range: DateRange,
  months: Month[] | undefined,
  interval: number,
  anchorDate: DateStr,
): { year: number; month: Month }[] {
  return eachMonth(range.start, range.end).filter(
    ({ year, month }) =>
      monthMatches(months, month) && monthPhaseMatches(interval, anchorDate, year, month),
  );
}

// ---------------------------------------------------------------------------
// monthlyByDay
// ---------------------------------------------------------------------------

function expandMonthlyByDay(
  recurrence: MonthlyByDayRecurrence,
  range: DateRange,
  anchorDate: DateStr,
): DateStr[] {
  const interval = normalizeInterval(recurrence.interval);
  const result: DateStr[] = [];
  for (const { year, month } of targetMonths(range, recurrence.months, interval, anchorDate)) {
    const last = lastDayOfMonth(year, month);
    const seen = new Set<number>();
    for (const spec of recurrence.days) {
      let day: number;
      if (spec === 'last') {
        day = last;
      } else if (!Number.isInteger(spec) || spec < 1) {
        continue;
      } else if (spec > last) {
        if (recurrence.overflow === 'skip') continue;
        day = last;
      } else {
        day = spec;
      }
      // days: [31, "last"] のように同じ日へ落ちる指定を1件にまとめる。
      if (seen.has(day)) continue;
      seen.add(day);
      result.push(makeDate(year, month, day));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// monthlyByWeekday
// ---------------------------------------------------------------------------

/** 指定月の第 nth 曜日。存在しなければ null（第5週が無い月など）。 */
export function nthWeekdayOfMonth(
  year: number,
  month: Month,
  weekday: Weekday,
  nth: number,
): DateStr | null {
  const last = lastDayOfMonth(year, month);
  if (nth > 0) {
    const firstWeekday = weekdayOf(makeDate(year, month, 1));
    const firstMatch = 1 + mod(weekday - firstWeekday, 7);
    const day = firstMatch + (nth - 1) * 7;
    return day <= last ? makeDate(year, month, day) : null;
  }
  if (nth === -1) {
    const lastWeekday = weekdayOf(makeDate(year, month, last));
    return makeDate(year, month, last - mod(lastWeekday - weekday, 7));
  }
  return null;
}

function expandMonthlyByWeekday(
  recurrence: MonthlyByWeekdayRecurrence,
  range: DateRange,
  anchorDate: DateStr,
): DateStr[] {
  const interval = normalizeInterval(recurrence.interval);
  const result: DateStr[] = [];
  for (const { year, month } of targetMonths(range, recurrence.months, interval, anchorDate)) {
    const seen = new Set<DateStr>();
    for (const nth of recurrence.nth) {
      const date = nthWeekdayOfMonth(year, month, recurrence.weekday, nth);
      // nth: 5 と nth: -1 が同じ日を指す月があるため重複を排除する。
      if (date === null || seen.has(date)) continue;
      seen.add(date);
      result.push(date);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// monthlyByBusinessDay
// ---------------------------------------------------------------------------

function expandMonthlyByBusinessDay(
  recurrence: MonthlyByBusinessDayRecurrence,
  range: DateRange,
  anchorDate: DateStr,
  calendar: BusinessDayCalendar,
): DateStr[] {
  const interval = normalizeInterval(recurrence.interval);
  const result: DateStr[] = [];
  for (const { year, month } of targetMonths(range, recurrence.months, interval, anchorDate)) {
    const seen = new Set<DateStr>();
    for (const nth of recurrence.nth) {
      const date = calendar.nthBusinessDayOfMonth(year, month, nth);
      // 営業日数が足りない月は発生させない。
      if (date === null || seen.has(date)) continue;
      seen.add(date);
      result.push(date);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// fiscalRelative
// ---------------------------------------------------------------------------

/**
 * 決算月の末日を起点に、offsetMonths か月ずらした月の day 日を求める。
 *
 * 決算月を変えるだけで申告期限や期首がまとめて追従するのが狙いなので、
 * 起点は「決算月」であって暦年ではない。
 */
export function fiscalRelativeDate(
  fiscalYear: number,
  fiscalYearEndMonth: Month,
  offsetMonths: number,
  day: number | 'last',
): DateStr {
  const total = fiscalYear * 12 + (fiscalYearEndMonth - 1) + offsetMonths;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = lastDayOfMonth(year, month);
  // 存在しない日は末日に丸める。申告期限などは「その月の末日まで」の意味になるため。
  const resolved = day === 'last' ? last : Math.min(Math.max(1, Math.floor(day)), last);
  return makeDate(year, month, resolved);
}

function expandFiscalRelative(
  recurrence: FiscalRelativeRecurrence,
  range: DateRange,
  fiscalYearEndMonth: Month,
): DateStr[] {
  const result: DateStr[] = [];
  // ずれが大きいと決算年と暦年が離れるため、前後2年ぶん多めに回してから範囲で切る。
  const fromYear = parseDate(range.start).year - 2;
  const toYear = parseDate(range.end).year + 2;

  for (let fiscalYear = fromYear; fiscalYear <= toYear; fiscalYear += 1) {
    for (const offset of recurrence.offsetMonths) {
      if (!Number.isInteger(offset)) continue;
      result.push(fiscalRelativeDate(fiscalYear, fiscalYearEndMonth, offset, recurrence.day));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// エントリポイント
// ---------------------------------------------------------------------------

/**
 * 反復条件を range 内で展開し、昇順・重複なしの基準日リストを返す。
 *
 * monthly 系は「月単位」で候補を作るため、range の端で月が欠けないよう
 * 呼び出し側（schedule.ts）が前後にマージンを取ってから渡すこと。
 */
export function expandRecurrence(
  recurrence: Recurrence,
  range: DateRange,
  ctx: ExpandContext,
): DateStr[] {
  const anchorDate = ctx.anchor ?? DEFAULT_ANCHOR;
  let dates: DateStr[];
  switch (recurrence.type) {
    case 'weekly':
      dates = expandWeekly(recurrence, range, anchorDate);
      break;
    case 'monthlyByDay':
      dates = expandMonthlyByDay(recurrence, range, anchorDate);
      break;
    case 'monthlyByWeekday':
      dates = expandMonthlyByWeekday(recurrence, range, anchorDate);
      break;
    case 'monthlyByBusinessDay':
      dates = expandMonthlyByBusinessDay(recurrence, range, anchorDate, ctx.calendar);
      break;
    case 'fiscalRelative':
      dates = expandFiscalRelative(recurrence, range, ctx.calendar.fiscalYearEndMonth);
      break;
  }
  const unique = [...new Set(dates)].sort();
  return unique.filter((date) => date >= range.start && date <= range.end);
}

/** monthlyByBusinessDay は定義上すでに営業日なので、営業日補正を適用しない。 */
export function skipsAdjustment(recurrence: Recurrence): boolean {
  return recurrence.type === 'monthlyByBusinessDay';
}
