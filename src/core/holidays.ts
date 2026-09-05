/**
 * 祝日データ（public/data/holidays.json）の参照レイヤ。
 * 取得元と生成方法は docs/SPEC.md §3。
 */

import type { DateStr, HolidayData, HolidayMeta } from '../types';
import { isValidDateStr } from './dateUtil';

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

/** 生の JSON が期待する形かを検証する。壊れたデータで無言に動き続けるのを防ぐ。 */
export function parseHolidayData(input: unknown): HolidayData {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('祝日データがオブジェクトではありません');
  }
  const candidate = input as Partial<HolidayData>;
  if (typeof candidate.holidays !== 'object' || candidate.holidays === null) {
    throw new TypeError('祝日データに holidays がありません');
  }
  if (typeof candidate.meta !== 'object' || candidate.meta === null) {
    throw new TypeError('祝日データに meta がありません');
  }
  const range = candidate.meta.range;
  if (
    typeof range !== 'object' ||
    range === null ||
    typeof range.from !== 'string' ||
    typeof range.to !== 'string' || !isValidDateStr(range.from) || !isValidDateStr(range.to) || range.from > range.to
  ) {
    throw new TypeError('祝日データの meta.range が不正です');
  }
  const entries = Object.entries(candidate.holidays);
  if (Array.isArray(candidate.holidays) || entries.length === 0 ||
      candidate.meta.count !== entries.length ||
      typeof candidate.meta.fetchedAt !== 'string' || !Number.isFinite(Date.parse(candidate.meta.fetchedAt)) ||
      entries.some(([date, name]) => !isValidDateStr(date) || date < range.from || date > range.to || typeof name !== 'string' || name.trim() === '')) {
    throw new TypeError('祝日データの件数・日付・名称が不正です');
  }
  return candidate as HolidayData;
}

export async function fetchHolidayData(url: string): Promise<HolidayData> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`祝日データの取得に失敗しました: ${response.status} ${response.statusText}`);
  }
  return parseHolidayData(await response.json());
}
