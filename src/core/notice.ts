/**
 * 前後予定（準備日・フォロー）の識別子と日付の決め方（docs/SPEC.md §5.4）。
 *
 * 識別子（id）・名称（label）は、日付の決め方（timing）から独立させる。
 * 決め方を差し替えても「同じ予定」でいられるようにするため。
 *
 * 識別子について:
 *   外部カレンダーの UID に配列の順番を使っていたため、1件消すと残りの識別子が
 *   ずれ、消したものの識別子を引き継いでしまっていた。取り込み先では、
 *   別の予定として増えたり、別の予定を上書きしたりする原因になる。
 *   固定の id を持たせて解決する。ただし既に書き出したぶんの UID を変えたくないので、
 *   古いデータには「今の順番」から `n0`, `n1`, … を割り当てる。
 */

import type { BusinessDayCalendar } from './businessDay';
import { addDays, addMonths, monthOf, weekdayOf, yearOf } from './dateUtil';
import type { DateStr, Notice, NoticeRole, NoticeTiming, Rule, Weekday } from '../types';

/** 順番から作る既定の id。移行時に既存の UID と一致させるための形。 */
export const legacyNoticeId = (index: number): string => `n${index}`;

/** 週の始まり。日本の実務では月曜起点で「翌週水曜」と数えることが多い。 */
export const WEEK_START: Weekday = 1;

/** 衝突しない新しい id。既存の `n0` 形式とぶつからないよう別の形にする。 */
function freshNoticeId(used: ReadonlySet<string>): string {
  for (let attempt = 0; ; attempt += 1) {
    const candidate = `x${Date.now().toString(36)}${attempt.toString(36)}${Math.floor(
      Math.random() * 1296,
    )
      .toString(36)
      .padStart(2, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** 既定の決め方。日数指定の3営業日前。 */
export const DEFAULT_TIMING = { kind: 'offset', offset: -3, unit: 'business' } as const;

/**
 * 日付の決め方を取り出す。古いデータは `offset`/`unit` を直に持っているので、
 * そこから作る。どちらも無い壊れたデータは既定で埋める（検証は別に行う）。
 */
export function timingOf(notice: Notice): NoticeTiming {
  if (notice.timing !== undefined) return notice.timing;
  return {
    kind: 'offset',
    offset: notice.offset ?? DEFAULT_TIMING.offset,
    unit: notice.unit ?? 'business',
  };
}

/**
 * 設定そのものが「本体の前か後か」を言い切っているか。言っていなければ null。
 *
 * 日数指定は符号で決まる。週・月で決めるものも、ずらす数が 0 でなければ向きは
 * 決まる（翌週は必ず後ろ、前月は必ず前）。0 のときだけは本体の位置しだいで
 * どちらにもなるので、設定からは決められない。
 *
 * ここを「意図」として持たせた値で埋めてしまうと、既定の 'after' と実際の
 * 向きが噛み合わないだけで警告が出続ける。設定が言っていないことは言わない。
 */
export function declaredRoleOf(notice: Notice): NoticeRole | null {
  const timing = timingOf(notice);
  switch (timing.kind) {
    case 'offset':
      return timing.offset < 0 ? 'before' : 'after';
    case 'weekday':
      return timing.weeks === 0 ? null : timing.weeks < 0 ? 'before' : 'after';
    case 'monthlyBusinessDay':
      return timing.months === 0 ? null : timing.months < 0 ? 'before' : 'after';
  }
}

/**
 * 本体の前・後どちらのつもりか。決め方を差し替えるときの初期値に使う。
 * 設定から決まらないものは、持っている意図、それも無ければ「後」とみなす。
 */
export function roleOf(notice: Notice): NoticeRole {
  return declaredRoleOf(notice) ?? notice.role ?? 'after';
}

/** 1件ぶんの新しい前後予定。id を先に決めておく。 */
export function createNotice(
  notice: { label: string; timing: NoticeTiming; role?: NoticeRole },
  existing: readonly Notice[] = [],
): Notice {
  const used = new Set(existing.map((item) => item.id).filter((id): id is string => id !== undefined));
  return { id: freshNoticeId(used), ...notice };
}

/**
 * id を補い、古い形式を `timing` へ均す。読み込み・取り込みの時点で1度だけ行う。
 * 既にあるものは触らない。id が重複していたら後のほうを付け直す。
 */
export function normalizeNotices(notices: readonly Notice[]): Notice[] {
  const used = new Set<string>();
  return notices.map((notice, index) => {
    const preferred = notice.id ?? legacyNoticeId(index);
    const id = used.has(preferred) ? freshNoticeId(used) : preferred;
    used.add(id);

    const timing = timingOf(notice);
    if (notice.id === id && notice.timing !== undefined) return notice;
    // 旧形式の offset/unit は timing に写したうえで落とす。二重に持たない。
    const { offset: _offset, unit: _unit, ...rest } = notice;
    return { ...rest, id, timing };
  });
}

export function normalizeRule(rule: Rule): Rule {
  const notices = normalizeNotices(rule.notices);
  return notices.every((notice, index) => notice === rule.notices[index])
    ? rule
    : { ...rule, notices };
}

// ---------------------------------------------------------------------------
// 日付の計算
// ---------------------------------------------------------------------------

/** その日が属する週の頭（既定では月曜）。 */
export function weekStartOf(date: DateStr, weekStart: Weekday = WEEK_START): DateStr {
  return addDays(date, -(((weekdayOf(date) - weekStart) % 7 + 7) % 7));
}

/**
 * 前後予定の日付。起点は本体の**確定日**（営業日補正のあと）。
 * 決められないときは null（長期休業で営業日を数えきれない、など）。
 */
export function noticeDate(
  effectiveDate: DateStr,
  timing: NoticeTiming,
  calendar: BusinessDayCalendar,
): DateStr | null {
  return noticeDateDetail(effectiveDate, timing, calendar).date;
}

/**
 * 日付と、休業日を避ける前に指していた日。
 *
 * 「翌週水曜」が木曜に出ていると、設定を間違えたのか休業日で動いたのかが
 * 画面から読み取れない。動いた理由を添えられるよう、避ける前の日も返す。
 * 動いていなければ `movedFrom` は null。
 */
export function noticeDateDetail(
  effectiveDate: DateStr,
  timing: NoticeTiming,
  calendar: BusinessDayCalendar,
): { date: DateStr | null; movedFrom: DateStr | null } {
  if (timing.kind === 'weekday') {
    const start = weekStartOf(effectiveDate);
    const target = addDays(
      addDays(start, timing.weeks * 7),
      ((timing.weekday - WEEK_START) % 7 + 7) % 7,
    );
    if (timing.onClosed === 'none' || calendar.isBusinessDay(target)) {
      return { date: target, movedFrom: null };
    }
    const moved =
      timing.onClosed === 'next' ? calendar.snap(target, 'next') : calendar.snap(target, 'prev');
    return { date: moved, movedFrom: moved === null ? null : target };
  }
  return { date: plainNoticeDate(effectiveDate, timing, calendar), movedFrom: null };
}

function plainNoticeDate(
  effectiveDate: DateStr,
  timing: NoticeTiming,
  calendar: BusinessDayCalendar,
): DateStr | null {
  switch (timing.kind) {
    case 'offset': {
      if (timing.offset === 0) return null;
      return timing.unit === 'calendar'
        ? addDays(effectiveDate, timing.offset)
        : calendar.addBusinessDays(effectiveDate, timing.offset);
    }
    case 'weekday':
      // 週と曜日は休業日を避けるかどうかで分かれるので noticeDateDetail が持つ。
      return noticeDateDetail(effectiveDate, timing, calendar).date;
    case 'monthlyBusinessDay': {
      const target = addMonths(effectiveDate, timing.months);
      return calendar.nthBusinessDayOfMonth(yearOf(target), monthOf(target), timing.nth);
    }
  }
}
