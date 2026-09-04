/**
 * ルール展開の統合（docs/SPEC.md §7.1）。
 *
 *   1. 反復条件を展開して基準日リストを得る
 *   2. period で絞り込む
 *   3. skipDates を除外する
 *   4. 営業日補正を適用して確定日を得る
 *   5. 同一ルール内で確定日が重複したものを1件に統合する
 *   6. notices を展開する
 *   7. 表示範囲外を切り落とす
 */

import type { BusinessDayCalendar } from './businessDay';
import type { DateRange, DateStr, Notice, Occurrence, Rule } from '../types';
import { adjustToBusinessDay } from './adjust';
import {
  addDays,
  addMonths,
  isWithin,
  lastDateOfMonth,
  makeDate,
  monthOf,
  parseDate,
  yearOf,
} from './dateUtil';
import { expandRecurrence, skipsAdjustment } from './recurrence';

/** 補正で月をまたぐ発生日を取りこぼさないためのマージン（月数）。 */
const MARGIN_MONTHS = 1;

export type ScheduleContext = {
  /** calendarId → 営業日カレンダー。 */
  calendars: ReadonlyMap<string, BusinessDayCalendar>;
  /** ルールの calendarId が見つからないときに使うフォールバック。 */
  fallbackCalendarId: string;
};

export type ExpandWarning = {
  ruleId: string;
  rawDate: DateStr | null;
  reason: 'unknown-calendar' | 'no-business-day';
  message: string;
};

export type ExpandResult = {
  occurrences: Occurrence[];
  warnings: ExpandWarning[];
};

/** 表示範囲の前後に月単位のマージンを付けた展開用レンジ。 */
export function withMargin(range: DateRange, months = MARGIN_MONTHS): DateRange {
  const start = addMonths(makeDate(yearOf(range.start), monthOf(range.start), 1), -months);
  const endMonth = addMonths(makeDate(yearOf(range.end), monthOf(range.end), 1), months);
  return { start, end: lastDateOfMonth(yearOf(endMonth), monthOf(endMonth)) };
}

function resolveCalendar(
  rule: Rule,
  ctx: ScheduleContext,
): { calendar: BusinessDayCalendar; warning: ExpandWarning | null } | null {
  const own = ctx.calendars.get(rule.calendarId);
  if (own !== undefined) return { calendar: own, warning: null };
  const fallback = ctx.calendars.get(ctx.fallbackCalendarId);
  if (fallback === undefined) return null;
  return {
    calendar: fallback,
    warning: {
      ruleId: rule.id,
      rawDate: null,
      reason: 'unknown-calendar',
      message: `営業日カレンダー "${rule.calendarId}" が見つからないため "${fallback.name}" で計算しました`,
    },
  };
}

/** 事前通知の日付。offset は負値、unit に応じて暦日／営業日で遡る。 */
export function noticeDateOf(
  effectiveDate: DateStr,
  notice: Notice,
  calendar: BusinessDayCalendar,
): DateStr | null {
  if (notice.offset >= 0) return null;
  return notice.unit === 'calendar'
    ? addDays(effectiveDate, notice.offset)
    : calendar.addBusinessDays(effectiveDate, notice.offset);
}

/** 1ルールを展開する。範囲の切り落としは行わない（呼び出し側で行う）。 */
function expandRule(
  rule: Rule,
  expandRange: DateRange,
  ctx: ScheduleContext,
): ExpandResult {
  const occurrences: Occurrence[] = [];
  const warnings: ExpandWarning[] = [];

  const resolved = resolveCalendar(rule, ctx);
  if (resolved === null) {
    return {
      occurrences,
      warnings: [
        {
          ruleId: rule.id,
          rawDate: null,
          reason: 'unknown-calendar',
          message: '利用できる営業日カレンダーがありません',
        },
      ],
    };
  }
  const { calendar } = resolved;
  if (resolved.warning !== null) warnings.push(resolved.warning);

  const rawDates = expandRecurrence(rule.recurrence, expandRange, {
    calendar,
    anchor: rule.period.start,
  });

  const skip = new Set(rule.skipDates);
  const noAdjust = skipsAdjustment(rule.recurrence);
  // 補正の結果として同じ確定日に集まった発生を1件へ統合する。
  const byEffectiveDate = new Map<DateStr, Occurrence>();

  for (const rawDate of rawDates) {
    if (!isWithin(rawDate, rule.period.start, rule.period.end)) continue;
    if (skip.has(rawDate)) continue;

    const adjusted = noAdjust
      ? { date: rawDate, shifted: false, direction: null as 'prev' | 'next' | null }
      : adjustToBusinessDay(rawDate, rule.adjust, calendar);

    if (adjusted === null) {
      warnings.push({
        ruleId: rule.id,
        rawDate,
        reason: 'no-business-day',
        message: `${rawDate} の周辺に営業日が見つからないため、この発生日を除外しました`,
      });
      continue;
    }

    if (byEffectiveDate.has(adjusted.date)) continue;
    byEffectiveDate.set(adjusted.date, {
      ruleId: rule.id,
      kind: 'main',
      rawDate,
      date: adjusted.date,
      shifted: adjusted.shifted,
      shiftDirection: adjusted.direction,
    });
  }

  for (const occurrence of byEffectiveDate.values()) {
    occurrences.push(occurrence);
    for (const notice of rule.notices) {
      const date = noticeDateOf(occurrence.date, notice, calendar);
      if (date === null) continue;
      occurrences.push({
        ruleId: rule.id,
        kind: 'notice',
        rawDate: occurrence.date,
        date,
        shifted: false,
        shiftDirection: null,
        noticeLabel: notice.label,
      });
    }
  }

  return { occurrences, warnings };
}

function compareOccurrence(a: Occurrence, b: Occurrence): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === 'main' ? -1 : 1;
  return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
}

/** 有効なルール群を表示範囲で展開する。 */
export function expandRules(
  rules: readonly Rule[],
  viewRange: DateRange,
  ctx: ScheduleContext,
): ExpandResult {
  const expandRange = withMargin(viewRange);
  const occurrences: Occurrence[] = [];
  const warnings: ExpandWarning[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const result = expandRule(rule, expandRange, ctx);
    warnings.push(...result.warnings);
    for (const occurrence of result.occurrences) {
      if (occurrence.date < viewRange.start || occurrence.date > viewRange.end) continue;
      occurrences.push(occurrence);
    }
  }

  occurrences.sort(compareOccurrence);
  return { occurrences, warnings };
}

/** 日付をキーにした索引。カレンダー描画で使う。 */
export function groupByDate(occurrences: readonly Occurrence[]): Map<DateStr, Occurrence[]> {
  const map = new Map<DateStr, Occurrence[]>();
  for (const occurrence of occurrences) {
    const list = map.get(occurrence.date);
    if (list === undefined) map.set(occurrence.date, [occurrence]);
    else list.push(occurrence);
  }
  return map;
}

/**
 * ルール編集フォームのプレビュー用（docs/SPEC.md §8.4）。
 * from 以降の本体発生日を count 件返す。見つからなければ探索を打ち切る。
 */
export function previewOccurrences(
  rule: Rule,
  from: DateStr,
  count: number,
  ctx: ScheduleContext,
  maxMonths = 60,
): Occurrence[] {
  const result: Occurrence[] = [];
  const { year, month } = parseDate(from);
  let cursor = makeDate(year, month, 1);

  // 1年分ずつ広げながら必要件数に達するまで探索する。
  for (let scanned = 0; scanned < maxMonths && result.length < count; scanned += 12) {
    const end = lastDateOfMonth(yearOf(addMonths(cursor, 11)), monthOf(addMonths(cursor, 11)));
    // 無効化中のルールでもプレビューは見せたいので enabled を立てて展開する。
    const { occurrences } = expandRules([{ ...rule, enabled: true }], { start: cursor, end }, ctx);
    for (const occurrence of occurrences) {
      if (occurrence.kind !== 'main' || occurrence.date < from) continue;
      result.push(occurrence);
      if (result.length >= count) break;
    }
    cursor = addMonths(cursor, 12);
  }
  return result;
}
