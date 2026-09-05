/**
 * ルール・カレンダー定義の検証（docs/SPEC.md §10.2）。
 * インポートしたデータや編集フォームの入力を、保存前にここで弾く。
 *
 * **入力は「型が正しい」と仮定してはいけない。** localStorage も取り込む JSON も
 * 外から来る任意の値であり、TypeScript の型は実行時には何も保証しない。
 * どんな値を渡されても例外を投げず、問題を issue として返しきることが責務である。
 */

import type { BusinessCalendar, Recurrence, Rule } from '../types';
import { isValidDateStr } from './dateUtil';

/** 実務でこれを超える設定は誤入力とみなす上限。無限ループや巨大ループを防ぐ。 */
export const LIMITS = {
  titleLength: 200,
  noteLength: 2000,
  notices: 20,
  /** 事前通知のさかのぼり日数。1年より前に知らせても意味がない。 */
  noticeOffset: 365,
  skipDates: 1000,
  arrayItems: 40,
  interval: 120,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isStringValue = (value: unknown): value is string => typeof value === 'string';

export type ValidationIssue = {
  /** 問題のあるフィールドのパス（例 "recurrence.days"）。 */
  path: string;
  message: string;
  severity: 'error' | 'warning';
};

const WEEKDAYS = new Set([0, 1, 2, 3, 4, 5, 6]);
const NTH_WEEKDAYS = new Set([1, 2, 3, 4, 5, -1]);
const ADJUST_MODES = new Set(['none', 'prev', 'next', 'nearest', 'both']);
const RECURRENCE_TYPES = new Set([
  'weekly',
  'monthlyByDay',
  'monthlyByWeekday',
  'monthlyByBusinessDay',
  'fiscalRelative',
]);

function validateRecurrence(recurrence: Recurrence, issues: ValidationIssue[]): void {
  if (!RECURRENCE_TYPES.has(recurrence.type)) {
    issues.push({ path: 'recurrence.type', message: '繰り返しの種類が不正です', severity: 'error' });
    return;
  }
  if (
    'interval' in recurrence &&
    (!Number.isInteger(recurrence.interval) ||
      recurrence.interval < 1 ||
      recurrence.interval > LIMITS.interval)
  ) {
    issues.push({
      path: 'recurrence.interval',
      message: `間隔は1〜${LIMITS.interval}の整数で指定してください`,
      severity: 'error',
    });
  }
  if ('months' in recurrence && recurrence.months !== undefined) {
    if (!Array.isArray(recurrence.months)) {
      issues.push({ path: 'recurrence.months', message: '対象月の指定が不正です', severity: 'error' });
      return;
    }
    for (const month of recurrence.months) {
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        issues.push({ path: 'recurrence.months', message: `対象月が不正です: ${String(month)}`, severity: 'error' });
      }
    }
  }

  switch (recurrence.type) {
    case 'weekly': {
      if (!Array.isArray(recurrence.weekdays)) {
        issues.push({ path: 'recurrence.weekdays', message: '曜日の指定が不正です', severity: 'error' });
        break;
      }
      if (recurrence.weekdays.length === 0) {
        issues.push({ path: 'recurrence.weekdays', message: '曜日を1つ以上選択してください', severity: 'error' });
      }
      for (const weekday of recurrence.weekdays) {
        if (!WEEKDAYS.has(weekday)) {
          issues.push({ path: 'recurrence.weekdays', message: `曜日が不正です: ${weekday}`, severity: 'error' });
        }
      }
      if (recurrence.anchor !== undefined && !isValidDateStr(recurrence.anchor)) {
        issues.push({ path: 'recurrence.anchor', message: '基準日の形式が不正です', severity: 'error' });
      }
      break;
    }
    case 'monthlyByDay': {
      if (!Array.isArray(recurrence.days)) {
        issues.push({ path: 'recurrence.days', message: '日の指定が不正です', severity: 'error' });
        break;
      }
      if (recurrence.days.length === 0) {
        issues.push({ path: 'recurrence.days', message: '日を1つ以上指定してください', severity: 'error' });
      }
      for (const day of recurrence.days) {
        if (day === 'last') continue;
        if (!Number.isInteger(day) || day < 1 || day > 31) {
          issues.push({ path: 'recurrence.days', message: `日が不正です: ${day}`, severity: 'error' });
        }
      }
      if (recurrence.overflow !== 'clamp' && recurrence.overflow !== 'skip') {
        issues.push({ path: 'recurrence.overflow', message: '存在しない日の扱いが不正です', severity: 'error' });
      }
      break;
    }
    case 'monthlyByWeekday': {
      if (!Array.isArray(recurrence.nth)) {
        issues.push({ path: 'recurrence.nth', message: '第N週の指定が不正です', severity: 'error' });
        break;
      }
      if (recurrence.nth.length === 0) {
        issues.push({ path: 'recurrence.nth', message: '第N週を1つ以上指定してください', severity: 'error' });
      }
      for (const nth of recurrence.nth) {
        if (!NTH_WEEKDAYS.has(nth)) {
          issues.push({ path: 'recurrence.nth', message: `第N週が不正です: ${nth}`, severity: 'error' });
        }
      }
      if (!WEEKDAYS.has(recurrence.weekday)) {
        issues.push({ path: 'recurrence.weekday', message: '曜日が不正です', severity: 'error' });
      }
      break;
    }
    case 'monthlyByBusinessDay': {
      if (!Array.isArray(recurrence.nth)) {
        issues.push({ path: 'recurrence.nth', message: '第N営業日の指定が不正です', severity: 'error' });
        break;
      }
      if (recurrence.nth.length > LIMITS.arrayItems) {
        issues.push({ path: 'recurrence.nth', message: '指定が多すぎます', severity: 'error' });
        break;
      }
      if (recurrence.nth.length === 0) {
        issues.push({ path: 'recurrence.nth', message: '第N営業日を1つ以上指定してください', severity: 'error' });
      }
      for (const nth of recurrence.nth) {
        if (!Number.isInteger(nth) || nth === 0) {
          issues.push({
            path: 'recurrence.nth',
            message: `第N営業日は0以外の整数で指定してください: ${nth}`,
            severity: 'error',
          });
        }
      }
      break;
    }

    case 'fiscalRelative': {
      if (!Array.isArray(recurrence.offsetMonths)) {
        issues.push({ path: 'recurrence.offsetMonths', message: 'ずれの指定が不正です', severity: 'error' });
        break;
      }
      if (recurrence.offsetMonths.length === 0) {
        issues.push({
          path: 'recurrence.offsetMonths',
          message: '決算月からのずれを1つ以上指定してください',
          severity: 'error',
        });
      }
      for (const offset of recurrence.offsetMonths) {
        if (!Number.isInteger(offset) || Math.abs(offset) > 24) {
          issues.push({
            path: 'recurrence.offsetMonths',
            message: `決算月からのずれは -24〜24 の整数で指定してください: ${offset}`,
            severity: 'error',
          });
        }
      }
      if (recurrence.day !== 'last' && (!Number.isInteger(recurrence.day) || recurrence.day < 1 || recurrence.day > 31)) {
        issues.push({ path: 'recurrence.day', message: `日が不正です: ${recurrence.day}`, severity: 'error' });
      }
      break;
    }
  }
}

/** 任意の値を受けても例外を投げずに検証する。 */
export function validateRule(rule: Rule): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const value: unknown = rule;

  if (!isRecord(value)) {
    return [{ path: '', message: 'ルールの形式が不正です', severity: 'error' }];
  }

  if (!isStringValue(value['id']) || value['id'] === '') {
    issues.push({ path: 'id', message: 'ID がありません', severity: 'error' });
  }

  const title = value['title'];
  if (!isStringValue(title) || title.trim() === '') {
    issues.push({ path: 'title', message: 'タイトルを入力してください', severity: 'error' });
  } else if (title.length > LIMITS.titleLength) {
    issues.push({
      path: 'title',
      message: `タイトルは${LIMITS.titleLength}文字以内にしてください`,
      severity: 'error',
    });
  }

  const note = value['note'];
  if (note !== undefined && (!isStringValue(note) || note.length > LIMITS.noteLength)) {
    issues.push({
      path: 'note',
      message: `メモは${LIMITS.noteLength}文字以内の文字列にしてください`,
      severity: 'error',
    });
  }

  if (typeof value['enabled'] !== 'boolean') {
    issues.push({ path: 'enabled', message: '有効/無効の指定が不正です', severity: 'error' });
  }
  if (!isStringValue(value['calendarId']) || value['calendarId'] === '') {
    issues.push({ path: 'calendarId', message: '営業日カレンダーの指定が不正です', severity: 'error' });
  }

  const recurrence = value['recurrence'];
  if (!isRecord(recurrence) || !isStringValue(recurrence['type'])) {
    issues.push({ path: 'recurrence', message: '繰り返しの指定がありません', severity: 'error' });
  } else {
    validateRecurrence(recurrence as unknown as Recurrence, issues);
  }

  const adjust = value['adjust'];
  if (!isRecord(adjust)) {
    issues.push({ path: 'adjust', message: '補正の指定がありません', severity: 'error' });
  } else {
    if (!ADJUST_MODES.has(String(adjust['mode']))) {
      issues.push({ path: 'adjust.mode', message: '補正の種類が不正です', severity: 'error' });
    }
    if (typeof adjust['keepInMonth'] !== 'boolean') {
      issues.push({ path: 'adjust.keepInMonth', message: '当月内補正の指定が不正です', severity: 'error' });
    }
  }

  const period = value['period'];
  if (!isRecord(period)) {
    issues.push({ path: 'period', message: '有効期間の指定がありません', severity: 'error' });
  } else {
    const start = period['start'];
    const end = period['end'];
    const startOk = start === null || (isStringValue(start) && isValidDateStr(start));
    const endOk = end === null || (isStringValue(end) && isValidDateStr(end));
    if (!startOk) {
      issues.push({ path: 'period.start', message: '開始日の形式が不正です', severity: 'error' });
    }
    if (!endOk) {
      issues.push({ path: 'period.end', message: '終了日の形式が不正です', severity: 'error' });
    }
    if (startOk && endOk && start !== null && end !== null && start > end) {
      issues.push({ path: 'period', message: '開始日が終了日より後になっています', severity: 'error' });
    }
  }

  const skipDates = value['skipDates'];
  if (!Array.isArray(skipDates)) {
    issues.push({ path: 'skipDates', message: '除外日の指定が不正です', severity: 'error' });
  } else if (skipDates.length > LIMITS.skipDates) {
    issues.push({
      path: 'skipDates',
      message: `除外日は${LIMITS.skipDates}件までにしてください`,
      severity: 'error',
    });
  } else {
    for (const date of skipDates) {
      if (!isStringValue(date) || !isValidDateStr(date)) {
        issues.push({
          path: 'skipDates',
          message: `除外日の形式が不正です: ${String(date)}`,
          severity: 'error',
        });
      }
    }
  }

  const notices = value['notices'];
  if (!Array.isArray(notices)) {
    issues.push({ path: 'notices', message: '事前通知の指定が不正です', severity: 'error' });
  } else if (notices.length > LIMITS.notices) {
    issues.push({
      path: 'notices',
      message: `事前通知は${LIMITS.notices}件までにしてください`,
      severity: 'error',
    });
  } else {
    notices.forEach((notice: unknown, index) => {
      if (!isRecord(notice)) {
        issues.push({ path: `notices[${index}]`, message: '事前通知の形式が不正です', severity: 'error' });
        return;
      }
      const offset = notice['offset'];
      if (
        typeof offset !== 'number' ||
        !Number.isInteger(offset) ||
        offset >= 0 ||
        // さかのぼり日数に上限を置く。営業日換算の巨大な値は、数えるだけで固まるため。
        offset < -LIMITS.noticeOffset
      ) {
        issues.push({
          path: `notices[${index}].offset`,
          message: `事前通知は -1 〜 -${LIMITS.noticeOffset} の整数で指定してください`,
          severity: 'error',
        });
      }
      if (notice['unit'] !== 'business' && notice['unit'] !== 'calendar') {
        issues.push({ path: `notices[${index}].unit`, message: '単位が不正です', severity: 'error' });
      }
      if (!isStringValue(notice['label']) || String(notice['label']).length > LIMITS.titleLength) {
        issues.push({ path: `notices[${index}].label`, message: 'ラベルが不正です', severity: 'error' });
      }
    });
  }

  return issues;
}

export function validateCalendar(calendar: BusinessCalendar): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const value: unknown = calendar;
  if (!isRecord(value)) {
    return [{ path: '', message: 'カレンダーの形式が不正です', severity: 'error' }];
  }
  if (!isStringValue(value['id']) || value['id'] === '') {
    issues.push({ path: 'id', message: 'ID がありません', severity: 'error' });
  }
  if (!isStringValue(value['name'])) {
    issues.push({ path: 'name', message: 'カレンダー名が不正です', severity: 'error' });
    return issues;
  }
  for (const key of ['weekendDays', 'closedRanges', 'closedDates', 'openDates'] as const) {
    if (!Array.isArray(value[key])) {
      issues.push({ path: key, message: `${key} の指定が不正です`, severity: 'error' });
      return issues;
    }
  }
  if (typeof value['useNationalHolidays'] !== 'boolean') {
    issues.push({ path: 'useNationalHolidays', message: '祝日設定が不正です', severity: 'error' });
  }
  if (
    calendar.fiscalYearEndMonth !== undefined &&
    (!Number.isInteger(calendar.fiscalYearEndMonth) ||
      calendar.fiscalYearEndMonth < 1 ||
      calendar.fiscalYearEndMonth > 12)
  ) {
    issues.push({ path: 'fiscalYearEndMonth', message: '決算月が不正です', severity: 'error' });
  }
  if (calendar.name.trim() === '') {
    issues.push({ path: 'name', message: 'カレンダー名を入力してください', severity: 'error' });
  }
  for (const weekday of calendar.weekendDays) {
    if (!WEEKDAYS.has(weekday)) {
      issues.push({ path: 'weekendDays', message: `曜日が不正です: ${weekday}`, severity: 'error' });
    }
  }
  if (calendar.weekendDays.length === 7) {
    issues.push({
      path: 'weekendDays',
      message: 'すべての曜日が休業日です。営業日が存在しません',
      severity: 'warning',
    });
  }
  for (const date of [...calendar.closedDates, ...calendar.openDates]) {
    if (!isStringValue(date) || !isValidDateStr(date)) {
      issues.push({ path: 'dates', message: `日付の形式が不正です: ${date}`, severity: 'error' });
    }
  }
  for (const range of calendar.closedRanges) {
    if (!isRecord(range) || !isStringValue(range.from) || !isStringValue(range.to)) {
      issues.push({ path: 'closedRanges', message: '休業期間の形式が不正です', severity: 'error' });
      continue;
    }
    if (!/^\d{2}-\d{2}$/.test(range.from) || !/^\d{2}-\d{2}$/.test(range.to)) {
      issues.push({
        path: 'closedRanges',
        message: `休業期間は MM-DD 形式で指定してください: ${range.from}〜${range.to}`,
        severity: 'error',
      });
    }
  }
  return issues;
}

export const hasError = (issues: readonly ValidationIssue[]): boolean =>
  issues.some((issue) => issue.severity === 'error');
