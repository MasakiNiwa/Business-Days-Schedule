/**
 * 外部 AI に渡す、手元の登録内容（docs/SPEC.md §9.5）。
 *
 * 利用者が「渡す」と選んだものだけを、依頼文に埋め込める形にする。
 * このアプリから AI へ送ることはない。依頼文をコピーして貼るのは利用者自身。
 *
 * - 登録済みの予定 … 1行に1件の JSON。直す指示を返してもらうため id と rev を添える
 * - 営業日カレンダー … 休業日の決め方（土日・祝日・年末年始など）
 * - 予定の一覧 … **このアプリが計算した**日付。AI には日付を計算させず、
 *   質問や引き継ぎ資料ではここに書いた日付だけを使ってもらう
 *
 * メモには取引先名や金額が書かれていることがあるので、既定では渡さない。
 */

import type { BusinessCalendar, DateStr, Notice, Rule } from '../types';
import { ruleRevision } from './conflict';
import {
  addMonths,
  firstDateOfMonth,
  lastDateOfMonth,
  monthOf,
  weekdayOf,
  yearOf,
} from './dateUtil';
import { occurrenceTitle, weekdayName } from './describe';
import { timingOf } from './notice';
import { expandRules } from './schedule';
import type { ScheduleContext } from './schedule';

/** AI に頼むこと。 */
export type AiPurpose = 'create' | 'revise' | 'review' | 'handover' | 'question';

export const AI_PURPOSES: readonly AiPurpose[] = ['create', 'revise', 'review', 'handover', 'question'];

/** 依頼文に入れる登録内容の選び方。 */
export type AiShareOptions = {
  rules: boolean;
  /** rules を渡すときに、メモも含めるか。 */
  notes: boolean;
  calendars: boolean;
  occurrences: boolean;
  /** 予定の一覧を、今月から何か月ぶん入れるか。 */
  months: number;
};

export const OCCURRENCE_MONTH_CHOICES: readonly number[] = [1, 3, 6, 12];

/**
 * 頼むことごとの既定。必要なものだけを入れ、渡しすぎない。
 *
 * - 作る … 何も渡さなくても作れる。既にある予定と重ねないよう渡すこともできる
 * - 直す・点検 … 登録済みの予定が要る
 * - 引き継ぎ・質問 … 日付を答えに使うので、予定の一覧も入れる
 */
export function defaultShareOptions(purpose: AiPurpose): AiShareOptions {
  switch (purpose) {
    case 'create':
      return { rules: false, notes: false, calendars: false, occurrences: false, months: 3 };
    case 'revise':
      return { rules: true, notes: false, calendars: false, occurrences: false, months: 3 };
    case 'review':
      return { rules: true, notes: false, calendars: true, occurrences: false, months: 3 };
    case 'handover':
      return { rules: true, notes: false, calendars: true, occurrences: true, months: 3 };
    case 'question':
      return { rules: true, notes: false, calendars: false, occurrences: true, months: 3 };
  }
}

/** 依頼文に埋め込む、組み立て済みの登録内容。 */
export type AiSharedData = {
  /** いつ時点の内容か。 */
  asOf: DateStr;
  /** 1行に1件の JSON。 */
  rules?: { lines: string[]; withNotes: boolean };
  calendars?: string[];
  occurrences?: { from: DateStr; to: DateStr; lines: string[]; truncated: boolean };
};

/** 予定の一覧に入れる行の上限。毎営業日の予定があると1年で数百行になるため。 */
export const OCCURRENCE_LINE_LIMIT = 600;

/** 前後予定を、取り込みと同じ形で書く（旧形式の offset/unit は timing に均してある）。 */
function noticeSnapshot(notice: Notice): Record<string, unknown> {
  return {
    ...(notice.id === undefined ? {} : { id: notice.id }),
    label: notice.label,
    timing: timingOf(notice),
    ...(notice.role === undefined ? {} : { role: notice.role }),
    ...(notice.calendarId === undefined ? {} : { calendarId: notice.calendarId }),
  };
}

/**
 * 登録済みのルール1件を、取り込みと同じ項目名で書く。
 *
 * AI はこれを写して直し、そのまま返せばよい。アプリが管理する項目（作成日時など）は
 * 渡さない。一時停止中のものだけ "enabled": false を添える（返ってきても読まない）。
 * 除外日は取り込みで扱わないので渡さない。
 */
export function ruleSnapshot(rule: Rule, withNotes: boolean): Record<string, unknown> {
  const hasPeriod = rule.period.start !== null || rule.period.end !== null;
  return {
    id: rule.id,
    rev: ruleRevision(rule),
    title: rule.title,
    ...(rule.enabled ? {} : { enabled: false }),
    calendarId: rule.calendarId,
    ...(rule.group === undefined || rule.group === '' ? {} : { group: rule.group }),
    recurrence: rule.recurrence,
    adjust: rule.adjust,
    ...(rule.notices.length === 0 ? {} : { notices: rule.notices.map(noticeSnapshot) }),
    ...(hasPeriod ? { period: rule.period } : {}),
    color: rule.color,
    ...(withNotes && rule.note !== undefined && rule.note !== '' ? { note: rule.note } : {}),
  };
}

/** 営業日カレンダーの休業日の決め方。祝日の一覧そのものは渡さない（アプリが持つ）。 */
export function calendarSnapshot(calendar: BusinessCalendar): string {
  const parts = [
    `休み: ${calendar.weekendDays.length === 0 ? 'なし' : calendar.weekendDays.map(weekdayName).join('・')}曜`,
    calendar.useNationalHolidays ? '祝日は休み' : '祝日も営業',
  ];
  if (calendar.closedRanges.length > 0) {
    parts.push(
      `毎年の休業: ${calendar.closedRanges.map((range) => `${range.label || '休業'} ${range.from}〜${range.to}`).join('、')}`,
    );
  }
  if (calendar.closedDates.length > 0) parts.push(`臨時休業日: ${calendar.closedDates.join('、')}`);
  if (calendar.openDates.length > 0) parts.push(`休業日だが営業する日: ${calendar.openDates.join('、')}`);
  if (calendar.fiscalYearEndMonth !== undefined) parts.push(`決算月: ${calendar.fiscalYearEndMonth}月`);
  return `"${calendar.id}"（${calendar.name}） … ${parts.join(' / ')}`;
}

const dateWithWeekday = (date: DateStr): string => `${date}（${weekdayName(weekdayOf(date))}）`;

/**
 * このアプリが計算した予定の一覧。今月の初めから months か月ぶん。
 *
 * 1行に1件、日付順。休業日で動いたものは理由を添える（AI が「なぜこの日か」を
 * 自分で計算し直さずに説明できるように）。
 */
export function occurrenceSnapshot(
  rules: readonly Rule[],
  ctx: ScheduleContext,
  today: DateStr,
  months: number,
): NonNullable<AiSharedData['occurrences']> {
  const from = firstDateOfMonth(yearOf(today), monthOf(today));
  const last = addMonths(from, months - 1);
  const to = lastDateOfMonth(yearOf(last), monthOf(last));
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const { occurrences } = expandRules(rules, { start: from, end: to }, ctx);
  const lines: string[] = [];
  for (const occurrence of occurrences) {
    const rule = byId.get(occurrence.ruleId);
    if (rule === undefined) continue;
    let line = `${dateWithWeekday(occurrence.date)} ${occurrenceTitle(occurrence, rule)}`;
    if (occurrence.kind === 'main' && occurrence.shifted) {
      line += `（本来は ${dateWithWeekday(occurrence.rawDate)}。休業日のため${occurrence.shiftDirection === 'prev' ? '前' : '後ろ'}へ）`;
    } else if (occurrence.noticeMovedFrom !== undefined) {
      line += `（本来は ${dateWithWeekday(occurrence.noticeMovedFrom)}。休業日のため移動）`;
    }
    if (rule.group !== undefined && rule.group !== '') line += ` [${rule.group}]`;
    lines.push(line);
  }
  const truncated = lines.length > OCCURRENCE_LINE_LIMIT;
  return { from, to, lines: truncated ? lines.slice(0, OCCURRENCE_LINE_LIMIT) : lines, truncated };
}

/** 選んだものだけを組み立てる。何も選ばなければ asOf だけ。 */
export function buildSharedData(
  source: { rules: readonly Rule[]; calendars: readonly BusinessCalendar[] },
  options: AiShareOptions,
  ctx: ScheduleContext,
  today: DateStr,
): AiSharedData {
  const data: AiSharedData = { asOf: today };
  if (options.rules) {
    data.rules = {
      lines: source.rules.map((rule) => JSON.stringify(ruleSnapshot(rule, options.notes))),
      withNotes: options.notes,
    };
  }
  if (options.calendars) data.calendars = source.calendars.map(calendarSnapshot);
  if (options.occurrences) {
    data.occurrences = occurrenceSnapshot(source.rules, ctx, today, Math.max(1, Math.floor(options.months)));
  }
  return data;
}
