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
import type {
  DateRange,
  DateStr,
  Notice,
  NoticeRole,
  NoticeTiming,
  Occurrence,
  Rule,
} from '../types';
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
  roleOf,
  noticeDate,
  noticeDateDetail,
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
    const bound = noticeBound(timingOf(notice), range, calendar);
    // 前後予定ごとの必要量は**足し合わせない**。同じ「30営業日前」を20件
    // 付けても必要な範囲は1件ぶんと変わらないのに、加算すると6年先まで
    // 探索して1秒かかっていた（入力のたびにプレビューを計算するので響く）。
    if (bound.start < start) start = bound.start;
    if (bound.end > end) end = bound.end;
  }
  // 休業日にある本体と、営業日補正で動く幅を足す。広げたぶんにだけ付ければよい。
  if (start < range.start) start = addDays(start, -MAX_SHIFT_DAYS * 2);
  if (end > range.end) end = addDays(end, MAX_SHIFT_DAYS * 2);
  return { start, end };
}

/**
 * その前後予定を取りこぼさないために本体を探すべき範囲。
 *
 * 日数の見積もりではなく、**実際のカレンダーを歩いて**求める。
 * 以前は 2000-01-03 を起点に暦日へ換算していたため、対象年だけ臨時休業が
 * 多いカレンダーで足りなくなり、年間の展開には出る準備日が月単位の展開では
 * 警告もなく消えていた。
 */
function noticeBound(
  timing: NoticeTiming,
  range: DateRange,
  calendar: BusinessDayCalendar,
): DateRange {
  switch (timing.kind) {
    case 'offset': {
      const size = Math.abs(timing.offset);
      if (size === 0) return range;
      if (timing.unit === 'calendar') {
        return timing.offset < 0
          ? { start: range.start, end: addDays(range.end, size) }
          : { start: addDays(range.start, -size), end: range.end };
      }
      // 「N営業日前」の前後予定は、本体が範囲の N営業日ぶん先にあっても範囲へ入る。
      // 休業が続いて数えきれないときは、暦日で多めに見て取りこぼしを防ぐ。
      if (timing.offset < 0) {
        const end = calendar.addBusinessDays(range.end, size) ?? addDays(range.end, size * 7);
        return { start: range.start, end };
      }
      const start = calendar.addBusinessDays(range.start, -size) ?? addDays(range.start, -size * 7);
      return { start, end: range.end };
    }
    case 'weekday': {
      // 週で決めるものは前後どちらへも動きうる。1週ぶん余分に見る。
      const slack = Math.abs(timing.weeks) * 7 + 7;
      return { start: addDays(range.start, -slack), end: addDays(range.end, slack) };
    }
    case 'monthlyBusinessDay': {
      // 月で決めるものも同じ。ずらす月数より1か月ぶん広く見る。
      const months = Math.abs(timing.months) + 1;
      return { start: addMonths(range.start, -months), end: addMonths(range.end, months) };
    }
  }
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
  /**
   * 前後予定についての警告なら、その設定上の向き。
   *
   * 書き出しでは準備日・フォローを別々に含める／含めないと選べる。
   * 含めないほうの警告まで出すと、書き出されるものと関係のない話になる。
   *
   * 日付を作れなかったものには実際の向きが無いので、これで判断するほかない。
   */
  noticeRole?: NoticeRole;
  /**
   * 日付を作れた前後予定なら、実際に出た側。
   *
   * 書き出す／書き出さないは実際の日付で決まる（`Occurrence.kind`）ので、
   * 警告の絞り込みもこちらに合わせる。設定上の向きで絞ると、
   * 「書き出されるのに警告が出ない」「書き出されないのに警告が出る」が起きる。
   */
  noticeKind?: 'notice' | 'follow';
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
  const { date, movedFrom } = noticeDateDetail(main.date, timingOf(notice), calendar);
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
          noticeRole: intended,
          noticeKind: kind,
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
      // 実際に前後どちらへ出たか（kind）とは別に、設定が言っている向きも持つ。
      // UID をこちらから作れば、休業日の設定を変えて前後が入れ替わっても
      // 同じ予定として扱われる。
      noticeRole: roleOf(notice),
      // 休業日を避けて動いたなら、避ける前の日。理由を添えるために持つ。
      ...(movedFrom === null ? {} : { noticeMovedFrom: movedFrom }),
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
          noticeRole: roleOf(notice),
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
    // 警告も表示範囲に合わせて絞る。探索範囲は本体を取りこぼさないために
    // 広げてあるので、そのまま返すと「3月を書き出したいのに前年11月の話」が
    // 混ざる。前後予定の警告は、その本体が表示範囲にあるかで判断する。
    for (const warning of result.warnings) {
      if (warning.rawDate === null) {
        warnings.push(warning);
        continue;
      }
      if (warning.rawDate < viewRange.start || warning.rawDate > viewRange.end) continue;
      warnings.push(warning);
    }
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
  /**
   * 日付を決められなかった前後予定と、その理由。
   *
   * 落として黙るとプレビューから消えるだけになり、保存する前に気づけない。
   * 「10月には第25営業日がありません」と、消えた場所に理由を残す。
   */
  unresolved: { notice: Notice; reason: string; detail: string }[];
  /** 日付は決まったが確かめてほしいもの（前後が意図と逆になった、など）。 */
  warnings: ExpandWarning[];
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
      result.push({ main: occurrence, ...relatedOf(rule, occurrence, calendar) });
      if (result.length >= count) break;
    }
    cursor = addMonths(cursor, 12);
  }
  return result;
}

/**
 * 1つの本体にぶら下がる準備日・フォローを、日付昇順で返す。
 * 決められなかったものと、確かめてほしいものも一緒に返す。
 */
function relatedOf(
  rule: Rule,
  main: Occurrence,
  calendar: BusinessDayCalendar | undefined,
): Omit<PreviewSeries, 'main'> {
  if (calendar === undefined) return { related: [], unresolved: [], warnings: [] };
  const related: Occurrence[] = [];
  const unresolved: { notice: Notice; reason: string; detail: string }[] = [];
  const warnings: ExpandWarning[] = [];
  rule.notices.forEach((notice, noticeIndex) => {
    // 展開と同じ組み立てを使う。別々に書くと画面と書き出しが食い違う。
    const built = buildRelated(rule, main, notice, noticeIndex, calendar);
    if (built === null) {
      unresolved.push({ notice, ...unresolvedReason(notice, main.date) });
      return;
    }
    related.push(built.occurrence);
    if (built.warning !== null) warnings.push(built.warning);
  });
  related.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { related, unresolved, warnings };
}

/**
 * なぜ日付を決められなかったか。原因が分からないと直しようがない。
 *
 * `reason` は回によらない言い方、`detail` はその回の具体。
 * 何か月ぶんも同じ理由が続くことがあるので、まとめて数えられるよう分けておく。
 */
function unresolvedReason(notice: Notice, mainDate: DateStr): { reason: string; detail: string } {
  const timing = timingOf(notice);
  switch (timing.kind) {
    case 'monthlyBusinessDay': {
      const target = addMonths(mainDate, timing.months);
      const size = Math.abs(timing.nth);
      const where = timing.nth < 0 ? '月末から' : '月初から';
      return {
        reason: 'その月には営業日が足りません',
        detail: `${yearOf(target)}年${monthOf(target)}月には${where}${size}営業日目がありません`,
      };
    }
    case 'offset':
      return {
        reason: '休業日が続いていて、その日数ぶんの営業日を数えきれません',
        detail: `${mainDate} を起点に数えきれませんでした`,
      };
    case 'weekday':
      return {
        reason: '休業日が続いていて、ずらす先の営業日が見つかりません',
        detail: `${mainDate} の回で見つかりませんでした`,
      };
  }
}
