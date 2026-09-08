/**
 * 祝日データ生成（docs/SPEC.md §3）。
 *
 *   holiday-jp/holiday_jp の holidays.yml
 *     → src/data/holidays.json（ビルドでアプリ本体へ同梱される）
 *
 * 出典の SHA を先に固定し、同じ版のデータを取得・検査して公開に使う。
 *
 * 生成物を public/ ではなく src/ に置くのは、起動時に取りに行かせないため。
 * 祝日データはデプロイのたびに作り直される「ビルド成果物」であって、
 * 配信中に中身が変わるものではない。それを毎回 fetch すると、
 * 何も得られないまま初回描画が1往復ぶん遅れる（§3.5）。
 *
 * 収録は出典の全期間。過去に遡って確かめたい場面があるため、年を絞らない。
 *
 * 使い方: npm run holidays
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isValidDateStr } from '../src/core/dateUtil';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HolidayData } from '../src/types';

const SOURCE_URL =
  'https://raw.githubusercontent.com/holiday-jp/holiday_jp/master/holidays.yml';
const COMMITS_API =
  'https://api.github.com/repos/holiday-jp/holiday_jp/commits?path=holidays.yml&per_page=1';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = resolve(ROOT, 'src/data/holidays.json');

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

/**
 * 認証トークンを付けるか。
 *
 * 認証なしの api.github.com は IP あたり60回/時で、共用ランナーでは
 * すぐ 403 rate limit exceeded になる（実際にそれで公開が止まった）。
 * GitHub Actions が渡すトークンを使えばリポジトリあたり1000回/時まで上がる。
 */
export function authHeaderFor(url: string): Record<string, string> {
  const token = process.env['GITHUB_TOKEN'];
  if (token === undefined || token === '') return {};
  if (!url.startsWith('https://api.github.com/')) return {};
  return { authorization: `Bearer ${token}` };
}

async function fetchText(url: string): Promise<string> {
  const base = { 'user-agent': 'business-days-schedule-build-script' };
  const auth = authHeaderFor(url);

  const attempt = async (headers: Record<string, string>): Promise<Response> =>
    fetch(url, { headers, signal: AbortSignal.timeout(15_000) });

  let response = await attempt({ ...base, ...auth });

  // トークンが期限切れ・別用途のものだと 401/403 になる。付けなければ通ることが
  // あるので、その場合だけ一度だけ認証なしで試す。付けたせいで失敗するのは本末転倒。
  if (!response.ok && Object.keys(auth).length > 0 && (response.status === 401 || response.status === 403)) {
    response = await attempt(base);
  }

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
  // 出典の全期間をそのまま持つ。過去の年を遡って見ることがあるため、
  // 年を絞って「その年は範囲外です」と出るほうが困る。
  const dates = Object.keys(holidays).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error('祝日が1件も取得できませんでした。既存データは更新しません');
  }
  // 差分を読みやすく保つため、キーは常に日付昇順で書き出す。
  const sorted: Record<string, string> = {};
  for (const date of dates) sorted[date] = holidays[date] as string;

  // 収録範囲は暦年の境界へ丸める。範囲末尾を最終祝日(2050-11-23 など)に
  // すると、その後の平日が「データ範囲外」と誤判定されてしまうため。
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

/**
 * 取得できなかったときに、リポジトリに入っている既存データで代替できるか調べる。
 *
 * 取得は「更新」であって「生成」ではない。前回の検査を通ったデータが手元にある
 * のに、更新に失敗しただけで公開そのものを止めるのは釣り合わない。
 * 実際に、認証なしの GitHub API が 403 になっただけで公開が丸ごと止まった。
 */
async function existingIsUsable(year: number): Promise<boolean> {
  try {
    const data = JSON.parse(await readFile(OUTPUT_PATH, 'utf-8')) as HolidayData;
    validatePublishedHolidays(data, year);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const now = new Date();
  const year = now.getUTCFullYear();

  let data: HolidayData;
  let sourceSha: string;
  try {
    sourceSha = await fetchSourceSha();
    const yml = await fetchText(
      `https://raw.githubusercontent.com/holiday-jp/holiday_jp/${sourceSha}/holidays.yml`,
    );
    data = buildHolidayData(parseHolidaysYml(yml), sourceSha, now);
    validatePublishedHolidays(data, year);
  } catch (error: unknown) {
    console.error(`祝日データを取得できませんでした: ${String(error)}`);
    if (await existingIsUsable(year)) {
      // 既存データは検査を通っている。更新できなかっただけなので、公開は続ける。
      console.log(`既存の ${OUTPUT_PATH} をそのまま使います（今回は更新しません）。`);
      return;
    }
    // 手元に使えるデータが無いなら、ここで止めるほかない。
    throw error;
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');

  console.log(
    `祝日データを生成しました: ${data.meta.count} 件 (${data.meta.range.from} 〜 ${data.meta.range.to})`,
  );
  console.log(`出典 SHA: ${sourceSha}`);
}

// テストから import されたときは実行しない。
const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
