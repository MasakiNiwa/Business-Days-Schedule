/**
 * 祝日データの参照レイヤ（docs/SPEC.md §3）。
 *
 * データはビルド時に生成した src/data/holidays.json をそのまま同梱している。
 * 起動時に取りに行かないので、通信の往復も、取得失敗時の分岐も存在しない。
 */

import bundled from '../data/holidays.json';
import type { DateStr, HolidayData, HolidayMeta } from '../types';

export type HolidayLookup = {
  readonly meta: HolidayMeta;
  isHoliday(date: DateStr): boolean;
  /** 祝日名。祝日でなければ null。 */
  nameOf(date: DateStr): string | null;
  /** データの収録範囲外か。範囲外の日は祝日判定が信頼できない。 */
  isOutOfRange(date: DateStr): boolean;
};

export function createHolidayLookup(data: HolidayData): HolidayLookup {
  const map = new Map<DateStr, string>(Object.entries(data.holidays));
  const { from, to } = data.meta.range;
  return {
    meta: data.meta,
    isHoliday: (date) => map.has(date),
    nameOf: (date) => map.get(date) ?? null,
    isOutOfRange: (date) => date < from || date > to,
  };
}

/** 同梱データ。生成と検査はビルド時に済んでいる（scripts/build-holidays.ts）。 */
export function createBundledHolidayLookup(): HolidayLookup {
  return createHolidayLookup(bundled as HolidayData);
}

/** 祝日を一切考慮しないルックアップ。テストや「祝日を使わない」設定で使う。 */
export function createEmptyHolidayLookup(): HolidayLookup {
  return createHolidayLookup({
    meta: {
      source: 'none',
      sourceUrl: '',
      sourceSha: null,
      fetchedAt: new Date(0).toISOString(),
      range: { from: '0000-01-01', to: '9999-12-31' },
      count: 0,
    },
    holidays: {},
  });
}

/**
 * 期間が祝日データの収録範囲に収まっているかを調べる。
 * 表示・一覧・書き出しのどこでも同じ判定を使うため、ここに一本化する。
 */
export function outOfRangeMessage(
  lookup: HolidayLookup,
  from: DateStr,
  to: DateStr,
): string | null {
  const { range } = lookup.meta;
  if (from >= range.from && to <= range.to) return null;
  return `${from} 〜 ${to} は祝日データの収録範囲（${range.from} 〜 ${range.to}）を外れています。範囲外の休業日判定は信頼できません。`;
}
