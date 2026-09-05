/**
 * 二次ソース検証（docs/SPEC.md §3.2）。
 *
 * 内閣府の祝日 CSV と public/data/holidays.json を突き合わせる。
 *
 * 終了コードで「一致」「不一致」「確認できず」を区別する。
 * 実データの不一致（祝日が違う）と、単に内閣府サイトへ届かなかった場合とでは
 * 取るべき行動が正反対で、まとめて失敗にすると誤ったデータを公開しかねないため。
 *
 *   0 … 一致した
 *   1 … 不一致があった（公開してはいけない）
 *   2 … 確認できなかった（取得・解釈に失敗。既存データは維持してよい）
 *
 * 使い方: npm run holidays:verify
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HolidayData } from '../src/types';

const CAO_CSV_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOLIDAYS_PATH = resolve(ROOT, 'public/data/holidays.json');

/** 突合の対象年数。内閣府 CSV の掲載範囲は翌年までなので過去側に広く取る。 */
const VERIFY_YEARS = 3;

/** "2026/1/1" / "2026-01-01" のどちらの表記でも受ける。 */
function normalizeCaoDate(value: string): string | null {
  const matched = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value.trim());
  if (matched === null) return null;
  const [, year, month, day] = matched;
  if (year === undefined || month === undefined || day === undefined) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function parseCaoCsv(text: string): Record<string, string> {
  const holidays: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    const [rawDate, ...rest] = line.split(',');
    if (rawDate === undefined) continue;
    const date = normalizeCaoDate(rawDate);
    // ヘッダー行（"国民の祝日・休日月日,..."）はここで弾かれる。
    if (date === null) continue;
    holidays[date] = rest.join(',').trim();
  }
  return holidays;
}

export type Diff = {
  date: string;
  ours: string | null;
  cao: string | null;
};

/**
 * 直近 years 年分を突合する。
 * 名称は表記ゆれ（「振替休日」の付き方など）があるため、日付の有無のみを比較する。
 */
export function diffHolidays(
  ours: Record<string, string>,
  cao: Record<string, string>,
  fromYear: number,
  years: number,
): Diff[] {
  const inScope = (date: string): boolean => {
    const year = Number(date.slice(0, 4));
    return year >= fromYear && year < fromYear + years;
  };
  const dates = new Set(
    [...Object.keys(ours), ...Object.keys(cao)].filter(inScope),
  );
  const diffs: Diff[] = [];
  for (const date of [...dates].sort()) {
    const a = ours[date] ?? null;
    const b = cao[date] ?? null;
    if ((a === null) !== (b === null)) diffs.push({ date, ours: a, cao: b });
  }
  return diffs;
}

/** 突合の結果。呼び出し側（CI）はこれを見て公開の可否を決める。 */
export const EXIT_MATCH = 0;
export const EXIT_MISMATCH = 1;
export const EXIT_UNVERIFIABLE = 2;

async function main(): Promise<void> {
  const data = JSON.parse(await readFile(HOLIDAYS_PATH, 'utf-8')) as HolidayData;

  let csv: string;
  try {
    const response = await fetch(CAO_CSV_URL, {
      headers: { 'user-agent': 'business-days-schedule-verify-script' },
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    // 内閣府 CSV は Shift_JIS。Node 22 は full-icu 同梱のためそのままデコードできる。
    csv = new TextDecoder('shift_jis').decode(await response.arrayBuffer());
  } catch (error) {
    // 届かなかっただけ。既存データが誤っている証拠ではないので、公開は止めない。
    console.error(`内閣府 CSV を取得できませんでした（確認できず）: ${String(error)}`);
    process.exitCode = EXIT_UNVERIFIABLE;
    return;
  }

  const cao = parseCaoCsv(csv);
  if (Object.keys(cao).length === 0) {
    console.error('内閣府 CSV を解釈できませんでした（形式が変わった可能性があります）');
    process.exitCode = EXIT_UNVERIFIABLE;
    return;
  }

  const fromYear = new Date().getUTCFullYear() - (VERIFY_YEARS - 1);
  const diffs = diffHolidays(data.holidays, cao, fromYear, VERIFY_YEARS);

  if (diffs.length === 0) {
    console.log(`一致しました: ${fromYear}年〜${fromYear + VERIFY_YEARS - 1}年 / 内閣府 ${Object.keys(cao).length} 件`);
    return;
  }

  console.error(`内閣府 CSV と ${diffs.length} 件の差異があります:`);
  for (const diff of diffs) {
    console.error(`  ${diff.date}  当データ: ${diff.ours ?? '(なし)'}  /  内閣府: ${diff.cao ?? '(なし)'}`);
  }
  process.exitCode = EXIT_MISMATCH;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
