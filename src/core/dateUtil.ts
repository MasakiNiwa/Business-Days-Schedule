/**
 * "YYYY-MM-DD" 文字列を第一級の日付表現として扱うユーティリティ。
 *
 * 実行環境のタイムゾーンに結果が左右されないよう、内部の Date は必ず UTC 00:00 で
 * 生成し、取り出しには getUTC* 系のみを使う（docs/SPEC.md §7.3）。
 * ローカル時刻系の API（new Date(文字列), getDate, getDay ...）はこのファイルの外でも使わない。
 */

import type { DateStr, Month, Weekday } from '../types';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export type YMD = { year: number; month: number; day: number };

/** 形式・実在性ともに妥当な "YYYY-MM-DD" か。 */
export function isValidDateStr(value: string): boolean {
  const parts = DATE_PATTERN.exec(value);
  if (!parts) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > lastDayOfMonth(year, month)) return false;
  return true;
}

export function parseDate(value: DateStr): YMD {
  const parts = DATE_PATTERN.exec(value);
  if (!parts) throw new RangeError(`日付形式が不正です: ${value}`);
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (month < 1 || month > 12 || day < 1 || day > lastDayOfMonth(year, month)) {
    throw new RangeError(`存在しない日付です: ${value}`);
  }
  return { year, month, day };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 年月日から "YYYY-MM-DD" を組み立てる。month/day の桁あふれは正規化される（例: 月13 → 翌年1月）。 */
export function makeDate(year: number, month: number, day: number): DateStr {
  const ms = Date.UTC(year, month - 1, day);
  return fromEpochMs(ms);
}

function toEpochMs(value: DateStr): number {
  const { year, month, day } = parseDate(value);
  return Date.UTC(year, month - 1, day);
}

function fromEpochMs(ms: number): DateStr {
  const d = new Date(ms);
  // 年は 4 桁を超える可能性があるが、本アプリの範囲では 4 桁固定で扱う。
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(value: DateStr, days: number): DateStr {
  return fromEpochMs(toEpochMs(value) + days * MS_PER_DAY);
}

/** b - a を日数で返す。 */
export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((toEpochMs(b) - toEpochMs(a)) / MS_PER_DAY);
}

/** 文字列比較で足りるが、意図を明示するために用意する。負 = a が過去。 */
export function compareDate(a: DateStr, b: DateStr): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: DateStr, b: DateStr): DateStr {
  return a <= b ? a : b;
}

export function maxDate(a: DateStr, b: DateStr): DateStr {
  return a >= b ? a : b;
}

/** start <= value <= end（端を含む）。 */
export function isWithin(value: DateStr, start: DateStr | null, end: DateStr | null): boolean {
  if (start !== null && value < start) return false;
  if (end !== null && value > end) return false;
  return true;
}

export function weekdayOf(value: DateStr): Weekday {
  return new Date(toEpochMs(value)).getUTCDay() as Weekday;
}

export function yearOf(value: DateStr): number {
  return parseDate(value).year;
}

export function monthOf(value: DateStr): Month {
  return parseDate(value).month as Month;
}

export function dayOf(value: DateStr): number {
  return parseDate(value).day;
}

/** "YYYY-MM" 形式。同一月の判定に使う。 */
export function monthKeyOf(value: DateStr): string {
  const { year, month } = parseDate(value);
  return `${String(year).padStart(4, '0')}-${pad2(month)}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function lastDayOfMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function firstDateOfMonth(year: number, month: number): DateStr {
  return makeDate(year, month, 1);
}

export function lastDateOfMonth(year: number, month: number): DateStr {
  return makeDate(year, month, lastDayOfMonth(year, month));
}

/** 月を加算する。日は加算先の月の末日に丸める（例: 1/31 + 1か月 → 2/28）。 */
export function addMonths(value: DateStr, months: number): DateStr {
  const { year, month, day } = parseDate(value);
  const total = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return makeDate(nextYear, nextMonth, Math.min(day, lastDayOfMonth(nextYear, nextMonth)));
}

/** a を起点に b までの月数。日は無視する。 */
export function diffMonths(a: DateStr, b: DateStr): number {
  const from = parseDate(a);
  const to = parseDate(b);
  return (to.year - from.year) * 12 + (to.month - from.month);
}

/** start から end まで（両端を含む）を昇順で列挙する。 */
export function* eachDate(start: DateStr, end: DateStr): Generator<DateStr> {
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    yield cursor;
  }
}

/** start から end まで（両端を含む）に含まれる各月を "YYYY-MM" 相当で列挙する。 */
export function eachMonth(start: DateStr, end: DateStr): { year: number; month: Month }[] {
  const from = parseDate(start);
  const to = parseDate(end);
  const result: { year: number; month: Month }[] = [];
  let year = from.year;
  let month = from.month;
  while (year < to.year || (year === to.year && month <= to.month)) {
    result.push({ year, month: month as Month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return result;
}

/** Asia/Tokyo における「今日」。実行環境のタイムゾーンに依存しない。 */
export function todayInTokyo(now: Date = new Date()): DateStr {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA は "YYYY-MM-DD" を返す。
  return formatter.format(now);
}
