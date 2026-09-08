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
import { adjustToBusinessDays } from './adjust';
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
import { describeTiming } from './describe';
import {
  declaredRoleOf,
  legacyNoticeId,
  noticeDate,
  noticeSpanDays,
  timingOf,
} from './notice';
import { expandRecurrence, skipsAdjustment } from './recurrence';
import { MAX_SHIFT_DAYS } from './businessDay';

/** 補正で月をまたぐ発生日を取りこぼさないためのマージン（月数）。 */
const MARGIN_MONTHS = 1;

/**
 * 前後予定が表示範囲に入る本体を取りこぼさないよう、探索範囲を広げる。
 *
 * 準備日は本体より前に出るので、本体は表示範囲より後ろにありうる（末尾を延ばす）。
 * フォローはその逆（先頭を戻す）。週や月で決めるものは前後どちらへも動きうるので、
 * 両側へ広げる。広げ忘れると、本体が範囲の外にあるぶんが黙って消える。
 */
export function expandBoundsFor(
  rule: Rule,
  range: DateRange,
  calendar: BusinessDayCalendar,
): DateRange {
  let { start, end } = range;
  for (const notice of rule.notices) {
    const span = noticeSpanDays(timingOf(notice), calendar);
    // 休業日にある本体と営業日補正の移動幅も含める。
    if (span.before > 0) {
      const bound = addDays(end, span.before + MAX_SHIFT_DAYS * 2);
      if (bound > end) end = bound;
    }
    if (span.after > 0) {
      const bound = addDays(start, -(span.after + MAX_SHIFT_DAYS * 2));
      if (bound < start) start = bound;
    }
  }
  return { start, end };
}

export type ScheduleContext = {
  /** calendarId → 営業日カレンダー。 */
  calendars: ReadonlyMap<string, BusinessDayCalendar>;
  /** ルールの calendarId が見つからないときに使うフォールバック。 */
  fallbackCalendarId: string;
};

export type ExpandWarning = {
  ruleId: string;
  rawDate: DateStr | null;
  reason: 'unknown-calendar' | 'no-business-day' | 'notice-unresolved' | 'notice-role-mismatch';
  message: string;
};

export type ExpandResult = {
  occurrences: Occurrence[];
  warnings: ExpandWarning[];
};

/**
 * 表示範囲の前後に月単位のマージンを付けた展開用レンジ。
 *
 * 末尾には事前通知ぶんの余白も足す。通知は本体より前に出るので、
 * 表示範囲より先の本体まで展開しないと通知が生成されない。
 */
export function withMargin(
  range: DateRange,
  months = MARGIN_MONTHS,
  extraEndDays = 0,
): DateRange {
  const start = addMonths(makeDate(yearOf(range.start), monthOf(range.start), 1), -months);
  const endMonth = addMonths(makeDate(yearOf(range.end), monthOf(range.end), 1), months);
  return {
    start,
    end: addDays(lastDateOfMonth(yearOf(endMonth), monthOf(endMonth)), extraEndDays),
  };
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

/**
 * 準備日・フォローの日付。
 * 符号が向きを決める。負なら本体より前へ、正なら本体より後へ、unit に応じて
 * 暦日／営業日で数える。0 は本体と同じ日になるので作らない。
 */
export function noticeDateOf(
  effectiveDate: DateStr,
  notice: Notice,
  calendar: BusinessDayCalendar,
): DateStr | null {
  return noticeDate(effectiveDate, timingOf(notice), calendar);
}

/**
 * 前後予定を1件ぶん組み立てる。展開とプレビューで同じ計算を使う。
 * 別々に書くと、片方だけ直したときに画面と書き出しが食い違う。
 */
function buildRelated(
  rule: Rule,
  main: Occurrence,
  notice: Notice,
  noticeIndex: number,
  calendar: BusinessDayCalendar,
): { occurrence: Occurrence; warning: ExpandWarning | null } | null {
  const date = noticeDateOf(main.date, notice, calendar);
  if (date === null) return null;

  // 前後の別は、意図ではなく実際の日付で決める。週や月で決めると、
  // 「翌週の月曜、休業日なら前営業日へ」が本体を追い越して前へ戻る、
  // といったことが起こりうるため。
  const kind = date < main.date ? 'notice' : 'follow';
  const intended = declaredRoleOf(notice);
  const actual = kind === 'notice' ? 'before' : 'after';
  // 設定が向きを言っていないもの（同じ週・同じ月）は照合しない。
  const warning: ExpandWarning | null =
    intended === null || intended === actual
      ? null
      : {
          ruleId: rule.id,
          rawDate: main.date,
          reason: 'notice-role-mismatch',
          message: `「${rule.title}」の${describeTiming(timingOf(notice))}（${notice.label}）は、${
            intended === 'before' ? '本体より前' : '本体より後'
          }のつもりの設定ですが ${date} に出ます（本体は ${main.date}）`,
        };

  return {
    occurrence: {
      ruleId: rule.id,
      kind,
      rawDate: main.date,
      // 本体の基準日を引き継ぐ。祝日データが変わっても動かない識別子にするため。
      baseDate: main.baseDate,
      date,
      shifted: false,
      shiftDirection: null,
      // 親（本体）の向きを引き継ぐ。両側補正のとき、これが無いと
      // 前倒し側と後ろ倒し側の子を見分けられない。
      seriesDirection: main.seriesDirection,
      noticeLabel: notice.label,
      noticeIndex,
      // UID は順番ではなく固定の id を使う。1件消しても残りが動かないように。
      noticeId: notice.id ?? legacyNoticeId(noticeIndex),
    },
    warning,
  };
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

    // adjust.mode: 'both' は1つの基準日から前後2件を返す。
    const adjusted = noAdjust
      ? [{ date: rawDate, shifted: false, direction: null as 'prev' | 'next' | null }]
      : adjustToBusinessDays(rawDate, rule.adjust, calendar);

    if (adjusted.length === 0) {
      warnings.push({
        ruleId: rule.id,
        rawDate,
        reason: 'no-business-day',
        message: `${rawDate} の周辺に営業日が見つからないため、この発生日を除外しました`,
      });
      continue;
    }

    for (const result of adjusted) {
      if (byEffectiveDate.has(result.date)) continue;
      byEffectiveDate.set(result.date, {
        ruleId: rule.id,
        kind: 'main',
        rawDate,
        baseDate: rawDate,
        date: result.date,
        shifted: result.shifted,
        shiftDirection: result.direction,
        seriesDirection: result.direction,
      });
    }
  }

  for (const occurrence of byEffectiveDate.values()) {
    occurrences.push(occurrence);
    rule.notices.forEach((notice, noticeIndex) => {
      const built = buildRelated(rule, occurrence, notice, noticeIndex, calendar);
      if (built === null) {
        // 長期休業などで営業日を数えきれないと日付が出せない。黙って消すと
        // 「設定したのに出ない」を追えなくなるので、警告として残す。
        warnings.push({
          ruleId: rule.id,
          rawDate: occurrence.date,
          reason: 'notice-unresolved',
          message: `「${rule.title}」の${describeTiming(timingOf(notice))}（${
            notice.label
          }）は ${occurrence.date} を起点に日付を決められませんでした`,
        });
        return;
      }
      occurrences.push(built.occurrence);
      if (built.warning !== null) warnings.push(built.warning);
    });
  }

  return { occurrences, warnings };
}

/** 同じ日では本体を先に、そのあと準備日・フォローの順で並べる。 */
const KIND_ORDER = { main: 0, notice: 1, follow: 2 } as const;

function compareOccurrence(a: Occurrence, b: Occurrence): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
}

/** 有効なルール群を表示範囲で展開する。 */
export function expandRules(
  rules: readonly Rule[],
  viewRange: DateRange,
  ctx: ScheduleContext,
): ExpandResult {
  const occurrences: Occurrence[] = [];
  const warnings: ExpandWarning[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    // 展開範囲はルールごとに決める。長い準備日・フォローを持つルールだけ広げる。
    const resolved = resolveCalendar(rule, ctx);
    const expandRange =
      resolved === null
        ? withMargin(viewRange)
        : expandBoundsFor(rule, withMargin(viewRange), resolved.calendar);
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
  return previewSeries(rule, from, count, ctx, maxMonths).map((series) => series.main);
}

/** 本体と、それに紐づく準備日・フォローの組。 */
export type PreviewSeries = {
  main: Occurrence;
  /** 日付昇順。本体より前のもの・後のものが混ざる。 */
  related: Occurrence[];
};

/**
 * 本体だけでなく、紐づく準備日・フォローも一緒に返す。
 *
 * 本体の日付しか出していなかったため、「3営業日前」を「3営業日後」と
 * 取り違えていても画面で気づけなかった。前後を並べて見せれば、
 * 保存する前に順番のおかしさが目に入る。
 */
export function previewSeries(
  rule: Rule,
  from: DateStr,
  count: number,
  ctx: ScheduleContext,
  maxMonths = 60,
): PreviewSeries[] {
  const result: PreviewSeries[] = [];
  const calendar = resolveCalendar(rule, ctx)?.calendar;
  const { year, month } = parseDate(from);
  let cursor = makeDate(year, month, 1);

  // 1年分ずつ広げながら必要件数に達するまで探索する。
  for (let scanned = 0; scanned < maxMonths && result.length < count; scanned += 12) {
    const end = lastDateOfMonth(yearOf(addMonths(cursor, 11)), monthOf(addMonths(cursor, 11)));
    // 無効化中のルールでもプレビューは見せたいので enabled を立てて展開する。
    const { occurrences } = expandRules([{ ...rule, enabled: true }], { start: cursor, end }, ctx);

    for (const occurrence of occurrences) {
      if (occurrence.kind !== 'main' || occurrence.date < from) continue;
      // 前後の予定は、展開結果から拾わずこの本体から直接数える。
      // 拾い方だと、探索範囲の境目をまたぐもの（8月の本体に対する9月のフォローなど）が
      // 切り落とされ、実際のカレンダーや書き出しと食い違ってしまう。
      result.push({ main: occurrence, related: relatedOf(rule, occurrence, calendar) });
      if (result.length >= count) break;
    }
    cursor = addMonths(cursor, 12);
  }
  return result;
}

/** 1つの本体にぶら下がる準備日・フォローを、日付昇順で返す。 */
function relatedOf(
  rule: Rule,
  main: Occurrence,
  calendar: BusinessDayCalendar | undefined,
): Occurrence[] {
  if (calendar === undefined) return [];
  const related: Occurrence[] = [];
  rule.notices.forEach((notice, noticeIndex) => {
    // 展開と同じ組み立てを使う。別々に書くと画面と書き出しが食い違う。
    const built = buildRelated(rule, main, notice, noticeIndex, calendar);
    if (built !== null) related.push(built.occurrence);
  });
  return related.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
