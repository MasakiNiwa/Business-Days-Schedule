/**
 * ルール・カレンダー定義の検証（docs/SPEC.md §10.2）。
 * インポートしたデータや編集フォームの入力を、保存前にここで弾く。
 */

import type { BusinessCalendar, Recurrence, Rule } from '../types';
import { isValidDateStr } from './dateUtil';

export type ValidationIssue = {
  /** 問題のあるフィールドのパス（例 "recurrence.days"）。 */
  path: string;
  message: string;
  severity: 'error' | 'warning';
};

const WEEKDAYS = new Set([0, 1, 2, 3, 4, 5, 6]);
const NTH_WEEKDAYS = new Set([1, 2, 3, 4, 5, -1]);

function validateRecurrence(recurrence: Recurrence, issues: ValidationIssue[]): void {
  if (!Number.isInteger(recurrence.interval) || recurrence.interval < 1) {
    issues.push({ path: 'recurrence.interval', message: '間隔は1以上の整数で指定してください', severity: 'error' });
  }
  if ('months' in recurrence && recurrence.months !== undefined) {
    for (const month of recurrence.months) {
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        issues.push({ path: 'recurrence.months', message: `対象月が不正です: ${month}`, severity: 'error' });
      }
    }
  }

  switch (recurrence.type) {
    case 'weekly': {
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
  }
}

export function validateRule(rule: Rule): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (rule.title.trim() === '') {
    issues.push({ path: 'title', message: 'タイトルを入力してください', severity: 'error' });
  }
  validateRecurrence(rule.recurrence, issues);

  const { start, end } = rule.period;
  if (start !== null && !isValidDateStr(start)) {
    issues.push({ path: 'period.start', message: '開始日の形式が不正です', severity: 'error' });
  }
  if (end !== null && !isValidDateStr(end)) {
    issues.push({ path: 'period.end', message: '終了日の形式が不正です', severity: 'error' });
  }
  if (start !== null && end !== null && isValidDateStr(start) && isValidDateStr(end) && start > end) {
    issues.push({ path: 'period', message: '開始日が終了日より後になっています', severity: 'error' });
  }

  for (const date of rule.skipDates) {
    if (!isValidDateStr(date)) {
      issues.push({ path: 'skipDates', message: `除外日の形式が不正です: ${date}`, severity: 'error' });
    }
  }

  rule.notices.forEach((notice, index) => {
    if (!Number.isInteger(notice.offset) || notice.offset >= 0) {
      issues.push({
        path: `notices[${index}].offset`,
        message: '事前通知は負の整数（何日前か）で指定してください',
        severity: 'error',
      });
    }
    if (notice.unit !== 'business' && notice.unit !== 'calendar') {
      issues.push({ path: `notices[${index}].unit`, message: '単位が不正です', severity: 'error' });
    }
  });

  return issues;
}

export function validateCalendar(calendar: BusinessCalendar): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
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
    if (!isValidDateStr(date)) {
      issues.push({ path: 'dates', message: `日付の形式が不正です: ${date}`, severity: 'error' });
    }
  }
  for (const range of calendar.closedRanges) {
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
