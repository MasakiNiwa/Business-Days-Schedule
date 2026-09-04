/**
 * 営業日補正（docs/SPEC.md §5.3）。
 *
 *   none    … 補正しない
 *   prev    … 休業日なら遡って最初の営業日へ
 *   next    … 休業日なら進んで最初の営業日へ
 *   nearest … 近い方の営業日へ。距離が同じなら prev を優先する
 *
 * keepInMonth が true の場合、補正結果が基準日と別の月になるときは逆方向を採用する。
 */

import type { Adjustment, DateStr } from '../types';
import type { BusinessDayCalendar } from './businessDay';
import { diffDays, monthKeyOf } from './dateUtil';

export type AdjustResult = {
  date: DateStr;
  shifted: boolean;
  direction: 'prev' | 'next' | null;
};

type Candidate = { date: DateStr; direction: 'prev' | 'next'; distance: number };

function candidatesFor(
  rawDate: DateStr,
  mode: Adjustment['mode'],
  calendar: BusinessDayCalendar,
): Candidate[] {
  const build = (direction: 'prev' | 'next'): Candidate | null => {
    const date = calendar.snap(rawDate, direction);
    if (date === null) return null;
    return { date, direction, distance: Math.abs(diffDays(rawDate, date)) };
  };

  if (mode === 'prev') return [build('prev')].filter((c): c is Candidate => c !== null);
  if (mode === 'next') return [build('next')].filter((c): c is Candidate => c !== null);

  // nearest: 距離の近い順。同距離のときは前倒し（prev）を優先する。
  const both = [build('prev'), build('next')].filter((c): c is Candidate => c !== null);
  return both.sort((a, b) =>
    a.distance !== b.distance
      ? a.distance - b.distance
      : a.direction === 'prev'
        ? -1
        : 1,
  );
}

/**
 * 基準日に営業日補正を適用する。
 * 補正先が見つからない場合（設定上ほぼ全日が休業など）は null を返し、呼び出し側で警告する。
 */
export function adjustToBusinessDay(
  rawDate: DateStr,
  adjustment: Adjustment,
  calendar: BusinessDayCalendar,
): AdjustResult | null {
  if (adjustment.mode === 'none' || calendar.isBusinessDay(rawDate)) {
    return { date: rawDate, shifted: false, direction: null };
  }

  const candidates = candidatesFor(rawDate, adjustment.mode, calendar);
  if (candidates.length === 0) return null;

  if (adjustment.keepInMonth) {
    const rawMonth = monthKeyOf(rawDate);
    const inMonth = candidates.find((c) => monthKeyOf(c.date) === rawMonth);
    if (inMonth !== undefined) {
      return { date: inMonth.date, shifted: true, direction: inMonth.direction };
    }
    // prev / next の単方向指定で月をまたいだ場合は逆方向を試す。
    if (adjustment.mode !== 'nearest') {
      const opposite = adjustment.mode === 'prev' ? 'next' : 'prev';
      const fallback = calendar.snap(rawDate, opposite);
      if (fallback !== null && monthKeyOf(fallback) === rawMonth) {
        return { date: fallback, shifted: true, direction: opposite };
      }
    }
    // 当月内に営業日が無い（全日休業など）。発生を破棄する。
    return null;
  }

  const chosen = candidates[0];
  if (chosen === undefined) return null;
  return { date: chosen.date, shifted: true, direction: chosen.direction };
}
