/**
 * 祝日データ生成（docs/SPEC.md §3）。
 *
 *   holiday-jp/holiday_jp の holidays.yml
 *     → public/data/holidays.json
 *
 * 出典の SHA を先に固定し、同じ版のデータを取得・検査して公開に使う。
 *
 * 使い方: npm run holidays
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { isValidDateStr } from '../src/core/dateUtil';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HolidayData } from '../src/types';

const SOURCE_URL =
  'https://raw.githubusercontent.com/holiday-jp/holiday_jp/master/holidays.yml';
const COMMITS_API =
  'https://api.github.com/repos/holiday-jp/holiday_jp/commits?path=holidays.yml&per_page=1';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = resolve(ROOT, 'public/data/holidays.json');

/** "2026-01-01: 元日" 形式の1行。値にコロンを含みうるので最初のコロンだけで分割する。 */
const LINE_PATTERN = /^(\d{4}-\d{2}-\d{2}):\s*(.+?)\s*$/;

export function parseHolidaysYml(text: string): Record<string, string> {
  const holidays: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line === '---' || line.startsWith('#')) continue;
    const matched = LINE_PATTERN.exec(line);
    if (matched === null) continue;
    const [, date, name] = matched;
    if (date === undefined || name === undefined) continue;
    if (!isValidDateStr(date) || date in holidays) throw new Error(`祝日の日付が不正または重複: ${date}`);
    // 引用符付きで書かれている場合に備えて剥がす。
    holidays[date] = name.replace(/^["'](.*)["']$/, '$1');
  }
  return holidays;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'business-days-schedule-build-script' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`取得に失敗しました (${response.status} ${response.statusText}): ${url}`);
  }
  return response.text();
}

/** データを取得する版と記録する版の食い違いを防ぐ。 */
async function fetchSourceSha(): Promise<string> {
  const commits = JSON.parse(await fetchText(COMMITS_API)) as { sha?: string }[];
  const sha = commits[0]?.sha;
  if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('出典の版を特定できません');
  return sha;
}

export function buildHolidayData(
  holidays: Record<string, string>,
  sourceSha: string | null,
  now: Date,
): HolidayData {
  const dates = Object.keys(holidays).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error('祝日が1件も取得できませんでした。既存データは更新しません');
  }
  // 差分を読みやすく保つため、キーは常に日付昇順で書き出す。
  const sorted: Record<string, string> = {};
  for (const date of dates) sorted[date] = holidays[date] as string;

  // 収録範囲は暦年の境界に丸める。範囲末尾を最終祝日(11/23 など)にすると、
  // その後の平日が「データ範囲外」と誤判定されてしまうため。
  const range = { from: `${first.slice(0, 4)}-01-01`, to: `${last.slice(0, 4)}-12-31` };

  return {
    meta: {
      source: 'holiday-jp/holiday_jp',
      sourceUrl: sourceSha === null ? SOURCE_URL : `https://raw.githubusercontent.com/holiday-jp/holiday_jp/${sourceSha}/holidays.yml`,
      sourceSha,
      fetchedAt: now.toISOString(),
      range,
      count: dates.length,
    },
    holidays: sorted,
  };
}

export function validatePublishedHolidays(data: HolidayData, year: number): void {
  for (const [date, name] of Object.entries(data.holidays)) {
    if (!isValidDateStr(date) || name.trim() === '') throw new Error(`祝日レコードが不正: ${date}`);
  }
  for (const target of [year, year + 1]) {
    const dates = Object.keys(data.holidays).filter((date) => date.startsWith(`${target}-`));
    if (dates.length < 16 || dates.length > 30) throw new Error(`${target}年の祝日件数が不正: ${dates.length}`);
    for (const suffix of ['01-01', '02-11', '11-03']) {
      if (!data.holidays[`${target}-${suffix}`]) throw new Error(`${target}-${suffix} がありません`);
    }
  }
}

async function main(): Promise<void> {
  const sourceSha = await fetchSourceSha();
  const yml = await fetchText(`https://raw.githubusercontent.com/holiday-jp/holiday_jp/${sourceSha}/holidays.yml`);
  const holidays = parseHolidaysYml(yml);
  const now = new Date();
  const data = buildHolidayData(holidays, sourceSha, now);
  validatePublishedHolidays(data, now.getUTCFullYear());

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');

  console.log(
    `祝日データを生成しました: ${data.meta.count} 件 (${data.meta.range.from} 〜 ${data.meta.range.to})`,
  );
  console.log(`出典 SHA: ${sourceSha ?? '(取得できず)'}`);
}

// テストから import されたときは実行しない。
const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
