/**
 * ルールを人間が読める日本語に変換する（UI 表示用の純粋関数）。
 *
 * 「毎月25日・休日なら前営業日」のように、設定内容が一目で分かる文言を組み立てる。
 * 表示ロジックだが DOM に依存しないため core に置き、テストで固定する。
 */

import type { Adjustment, Month, Recurrence, Rule } from '../types';

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const;

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday] ?? '?';
}

/** 数値の並びを「2・4」のように中黒で連結する。 */
function joinList(values: readonly string[]): string {
  return values.join('・');
}

/** months を「3・6・9・12月の」という接頭辞にする。未指定なら空文字。 */
function monthsPrefix(months: Month[] | undefined): string {
  if (months === undefined || months.length === 0 || months.length === 12) return '';
  const sorted = [...months].sort((a, b) => a - b);
  return `${joinList(sorted.map(String))}月の`;
}

/** interval を「毎月」「隔月」「3か月ごとの」のような接頭辞にする。 */
function monthlyIntervalPrefix(interval: number, hasMonths: boolean): string {
  if (interval <= 1) return hasMonths ? '' : '毎月';
  if (interval === 2) return '隔月';
  return `${interval}か月ごと`;
}

function describeNthWeekday(nth: number): string {
  return nth === -1 ? '最終' : `第${nth}`;
}

/**
 * 「毎月」「3・6・9・12月の」といった接頭辞に続けて読める形にする。
 * 月末起点を「月末N営業日前」とすると接頭辞と繋いだとき「毎月月末…」と月が重なるため、
 * 「末からN営業日前」と表記して「毎月末から2営業日前」と読ませる。
 */
function describeNthBusinessDay(nth: number): string {
  if (nth === -1) return '末営業日';
  if (nth < 0) return `末から${Math.abs(nth)}営業日前`;
  return `第${nth}営業日`;
}

export function describeRecurrence(recurrence: Recurrence): string {
  switch (recurrence.type) {
    case 'weekly': {
      const days = joinList(recurrence.weekdays.map((w) => `${weekdayName(w)}曜`));
      if (days === '') return '曜日未設定';
      if (recurrence.interval <= 1) return `毎週${days}`;
      if (recurrence.interval === 2) return `隔週${days}`;
      return `${recurrence.interval}週ごと${days}`;
    }

    case 'monthlyByDay': {
      const days = joinList(
        recurrence.days.map((day) => (day === 'last' ? '末日' : `${day}日`)),
      );
      if (days === '') return '日付未設定';
      const months = monthsPrefix(recurrence.months);
      // 単月指定かつ毎年なら「毎年4月1日」と読ませる。
      if (recurrence.months?.length === 1 && recurrence.interval <= 1) {
        return `毎年${recurrence.months[0]}月${days}`;
      }
      const interval = monthlyIntervalPrefix(recurrence.interval, months !== '');
      return `${interval}${months}${days}`;
    }

    case 'monthlyByWeekday': {
      const nth = joinList(recurrence.nth.map(describeNthWeekday));
      if (nth === '') return '週未設定';
      const months = monthsPrefix(recurrence.months);
      const interval = monthlyIntervalPrefix(recurrence.interval, months !== '');
      return `${interval}${months}${nth}${weekdayName(recurrence.weekday)}曜`;
    }

    case 'monthlyByBusinessDay': {
      const nth = joinList(recurrence.nth.map(describeNthBusinessDay));
      if (nth === '') return '営業日未設定';
      const months = monthsPrefix(recurrence.months);
      const interval = monthlyIntervalPrefix(recurrence.interval, months !== '');
      return `${interval}${months}${nth}`;
    }
  }
}

export function describeAdjustment(adjust: Adjustment, recurrence?: Recurrence): string {
  // 第N営業日は定義上すでに営業日なので、補正の説明を出すとかえって紛らわしい。
  if (recurrence?.type === 'monthlyByBusinessDay') return '';
  const scope = adjust.keepInMonth ? '（当月内）' : '';
  switch (adjust.mode) {
    case 'none':
      return '補正なし';
    case 'prev':
      return `休業日なら前営業日${scope}`;
    case 'next':
      return `休業日なら翌営業日${scope}`;
    case 'nearest':
      return `休業日なら近い営業日${scope}`;
    case 'both':
      return `休業日なら前後の営業日の両方${scope}`;
  }
}

/** 「毎月25日 / 休業日なら前営業日」のような1行サマリ。 */
export function describeRule(rule: Rule): string {
  const parts = [describeRecurrence(rule.recurrence), describeAdjustment(rule.adjust, rule.recurrence)];
  return parts.filter((part) => part !== '').join(' / ');
}

/** 「3営業日前」のような事前通知の説明。 */
export function describeNotice(offset: number, unit: 'business' | 'calendar'): string {
  const amount = Math.abs(offset);
  return unit === 'business' ? `${amount}営業日前` : `${amount}日前`;
}

/** 有効期間の説明。無期限なら空文字。 */
export function describePeriod(period: Rule['period']): string {
  const { start, end } = period;
  if (start === null && end === null) return '';
  if (start !== null && end !== null) return `${start} 〜 ${end}`;
  if (start !== null) return `${start} 〜`;
  return `〜 ${end ?? ''}`;
}
