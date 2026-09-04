/**
 * 祝日データ生成（docs/SPEC.md §3）。
 *
 *   holiday-jp/holiday_jp の holidays.yml
 *     → public/data/holidays.json
 *
 * 内閣府 CSV は Shift_JIS・掲載範囲が翌年までと扱いにくいため一次ソースにはせず、
 * scripts/verify-cao.ts で二次検証にのみ用いる。
 *
 * 使い方: npm run holidays
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
    // 引用符付きで書かれている場合に備えて剥がす。
    holidays[date] = name.replace(/^["'](.*)["']$/, '$1');
  }
  return holidays;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'business-days-schedule-build-script' },
  });
  if (!response.ok) {
    throw new Error(`取得に失敗しました (${response.status} ${response.statusText}): ${url}`);
  }
  return response.text();
}

/** 出典の版を記録するためのコミット SHA。取得できなくても致命的ではない。 */
async function fetchSourceSha(): Promise<string | null> {
  try {
    const response = await fetch(COMMITS_API, {
      headers: {
        'user-agent': 'business-days-schedule-build-script',
        accept: 'application/vnd.github+json',
      },
    });
    if (!response.ok) return null;
    const commits = (await response.json()) as { sha?: string }[];
    return commits[0]?.sha ?? null;
  } catch {
    return null;
  }
}

/** 既存 JSON の verifiedAgainstCao を引き継ぐ（本スクリプトは検証を行わないため）。 */
async function readExistingVerification(): Promise<boolean | null> {
  try {
    const existing = JSON.parse(await readFile(OUTPUT_PATH, 'utf-8')) as HolidayData;
    return existing.meta.verifiedAgainstCao ?? null;
  } catch {
    return null;
  }
}

export function buildHolidayData(
  holidays: Record<string, string>,
  sourceSha: string | null,
  verifiedAgainstCao: boolean | null,
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
      sourceUrl: SOURCE_URL,
      sourceSha,
      fetchedAt: now.toISOString(),
      range,
      count: dates.length,
      verifiedAgainstCao,
    },
    holidays: sorted,
  };
}

async function main(): Promise<void> {
  const yml = await fetchText(SOURCE_URL);
  const holidays = parseHolidaysYml(yml);
  const [sourceSha, verified] = await Promise.all([
    fetchSourceSha(),
    readExistingVerification(),
  ]);
  const data = buildHolidayData(holidays, sourceSha, verified, new Date());

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
