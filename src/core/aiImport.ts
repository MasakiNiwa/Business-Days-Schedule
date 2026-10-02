/**
 * 外部 AI が作った設定の取り込み（docs/SPEC.md §9.5）。
 *
 * 利用者が自分の使っている AI（ChatGPT / Claude / Gemini など）に依頼文を渡し、
 * 返ってきた回答を貼り付けてもらう。このアプリ自身は AI と通信しない。
 *
 * **AI の回答は信用できない外部入力として扱う。** ここでは
 *
 *   1. 回答から JSON を1つ取り出す（parseAiReply）
 *   2. 決めた形どおりかを厳しく確かめ、知っている項目だけを拾って Rule を組む
 *      （validateAiImport）
 *   3. 既存のルールに触れずに足す（appendImportedRules）
 *
 * までを受け持つ。日付は AI に計算させない。AI が返すのは「毎月25日・休業日なら
 * 前営業日」というルールそのものであり、何日になるかは既存の営業日計算が決める。
 *
 * 画面（src/ui/AiImportView.ts）からは独立させてある。将来 AI の API へ直接
 * 依頼する形にしても、JSON を作る部分だけを差し替えればここはそのまま使える。
 */

import type {
  Adjustment,
  AdjustMode,
  BusinessCalendar,
  ColorToken,
  DateStr,
  Month,
  Notice,
  NoticeRole,
  NoticeTiming,
  Recurrence,
  Rule,
  Weekday,
} from '../types';
import { isValidDateStr } from './dateUtil';
import { describeNoticeCalendar, describePeriod, describeRule, describeTiming } from './describe';
import { normalizeRule, timingOf } from './notice';
import { previewSeries } from './schedule';
import type { PreviewSeries, ScheduleContext } from './schedule';
import { createRule, newRuleId } from './storage';
import { LIMITS, validateRule } from './validate';

/** 取り込み用の形の識別子。バックアップの JSON と取り違えないために持たせる。 */
export const AI_IMPORT_FORMAT = 'business-days-schedule-ai-import';
export const AI_IMPORT_SCHEMA_VERSION = 1;

export const AI_IMPORT_LIMITS = {
  /** 貼り付けられる文字数。ルール数十件ぶんの JSON に説明文が付いても収まる大きさ。 */
  inputLength: 100_000,
  /** 1回で取り込めるルールの数。これより多いのは依頼の取り違えとみなす。 */
  rules: 30,
  /** 出す問題の数。壊れ方がひどいと同じ指摘が何百件も並ぶため。 */
  issues: 40,
} as const;

/**
 * 取り込みで見つかった問題。
 *
 * `message` は利用者に見せる文。JSON の知識を求めない言い方にする。
 * `fix` は AI に直してもらうための指示。項目名と使える値をそのまま書く。
 */
export type AiImportIssue = {
  severity: 'error' | 'warning';
  /** 問題の場所（例 "rules[0].adjust.mode"）。技術的な詳細として出す。 */
  path: string;
  message: string;
  fix: string;
  /** どの予定の話か（例「1件目「支払」」）。全体の話なら未設定。 */
  subject?: string;
};

// ---------------------------------------------------------------------------
// 1. 回答から JSON を取り出す
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; value: unknown; source: 'whole' | 'codeBlock' | 'embedded' }
  | { ok: false; issue: AiImportIssue };

const parseFailure = (message: string, fix: string): ParseResult => ({
  ok: false,
  issue: { severity: 'error', path: '', message, fix },
});

type Attempt = { ok: true; value: unknown } | { ok: false; error: string };

function tryParse(text: string): Attempt {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    // 深すぎる入れ子は RangeError になる。どんな例外でも「読めない」として返す。
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** この取り込み用の形だと名乗っているか。候補が複数あるときの決め手にする。 */
const declaresFormat = (value: unknown): boolean =>
  isPlainObject(value) && Object.hasOwn(value, 'format') && value['format'] === AI_IMPORT_FORMAT;

/** ``` で囲まれた部分。言語名が json か無しのもの、または { で始まるものだけを候補にする。 */
function codeBlocks(text: string): string[] {
  const blocks: string[] = [];
  // 行頭の ``` だけを囲みとみなす。文中で「```json で出力して」と触れただけのものを
  // 囲みの始まりと取ると、本物の囲みとの対応がずれる。
  const pattern = /(?:^|\n)[ \t]*```[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g;
  for (const match of text.matchAll(pattern)) {
    const language = (match[1] ?? '').toLowerCase();
    const body = (match[2] ?? '').trim();
    if (['json', 'jsonc', 'json5', ''].includes(language) || body.startsWith('{')) {
      blocks.push(body);
    }
  }
  return blocks;
}

/**
 * 文中にある、いちばん外側の { … } を取り出す。
 * 括弧の対応は文字列の中を数えないようにして取る。中身の意味は推測しない。
 */
function embeddedObjects(text: string): { objects: string[]; unclosed: boolean } {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    // 括弧の外の引用符は地の文なので数えない。
    if (char === '"' && depth > 0) inString = true;
    else if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0) objects.push(text.slice(start, index + 1));
    }
  }
  return { objects, unclosed: depth > 0 };
}

/**
 * 候補の中から1つに決める。読めたものが1つならそれ、複数なら
 * この形を名乗っているものが1つだけのときに限ってそれを選ぶ。
 */
function pickOne(
  candidates: readonly string[],
  source: 'codeBlock' | 'embedded',
): ParseResult | null {
  const parsed: unknown[] = [];
  let firstError: string | null = null;
  for (const candidate of candidates) {
    const attempt = tryParse(candidate);
    if (attempt.ok && isPlainObject(attempt.value)) parsed.push(attempt.value);
    else if (!attempt.ok && firstError === null) firstError = attempt.error;
  }
  if (parsed.length === 1) return { ok: true, value: parsed[0], source };
  if (parsed.length > 1) {
    const marked = parsed.filter(declaresFormat);
    if (marked.length === 1) return { ok: true, value: marked[0], source };
    return parseFailure(
      'AIの回答に設定データが複数含まれていて、どれを読み込めばよいか判断できません。',
      `設定データ（"format": "${AI_IMPORT_FORMAT}" を持つ JSON）を1つだけ出力してください。複数の予定は1つの JSON の rules 配列にまとめてください。`,
    );
  }
  if (firstError !== null) {
    return parseFailure(
      'AIの回答に含まれる設定データの書き方が崩れていて、読み込めませんでした。',
      `JSON の構文に誤りがあります（${firstError}）。正しい JSON に直して出力し直してください。`,
    );
  }
  return null;
}

/**
 * AI の回答から設定データ（JSON）を1つ取り出す。
 *
 * 1. 全体が JSON ならそのまま
 * 2. ```json のコードブロックがあればその中身
 * 3. 文中に { … } が1つだけはっきりあればそれ
 * 4. 決められなければエラー
 *
 * 壊れた JSON を推測で直すことはしない。直すのは AI の仕事として、
 * 修正の依頼文を作れるだけの情報を返す。
 */
export function parseAiReply(input: string): ParseResult {
  if (input.length > AI_IMPORT_LIMITS.inputLength) {
    return parseFailure(
      `貼り付けた内容が長すぎます（${AI_IMPORT_LIMITS.inputLength.toLocaleString('ja-JP')} 文字まで）。AIの回答のうち、設定データの部分だけを貼り付けてください。`,
      `出力が長すぎます。説明文を省き、設定データの JSON だけを出力してください。予定は1回に ${AI_IMPORT_LIMITS.rules} 件までにしてください。`,
    );
  }
  // 先頭の BOM はコピーで紛れ込むことがあるので落とす。
  const text = input.replace(/^﻿/, '').trim();
  if (text === '') {
    return parseFailure('AIの回答を貼り付けてください。', '設定データの JSON を出力してください。');
  }

  const whole = tryParse(text);
  if (whole.ok) return { ok: true, value: whole.value, source: 'whole' };

  const fromBlocks = pickOne(codeBlocks(text), 'codeBlock');
  if (fromBlocks !== null) return fromBlocks;

  const { objects, unclosed } = embeddedObjects(text);
  const fromText = pickOne(objects, 'embedded');
  if (fromText !== null) return fromText;

  if (unclosed) {
    return parseFailure(
      'AIの回答が途中で切れているようです。回答の最後までコピーできているか確かめてください。',
      '出力が途中で終わっています。設定データの JSON を最後の } まで出力し直してください。',
    );
  }
  return parseFailure(
    'AIの回答の中に、このアプリで読み込める設定データが見つかりませんでした。',
    `設定データを、"format": "${AI_IMPORT_FORMAT}" を持つ JSON として \`\`\`json コードブロックで出力してください。`,
  );
}

// ---------------------------------------------------------------------------
// 2. 形を確かめて Rule を組む
// ---------------------------------------------------------------------------

/**
 * 項目ごとの扱い（docs/SPEC.md §9.5）。
 *
 * - 一番外側の知らない項目は、意味に関わらないので警告にして無視する
 *   （"explanation" のような説明を AI が添えることがある）
 * - 予定（rules の中身）の知らない項目は**エラー**にする。"adjustment" のような
 *   書き間違いを無視すると、休業日の扱いが抜けたまま黙って登録されてしまう
 * - ただし id・日時など、このアプリが付け直すものは警告にして無視する
 * - 繰り返し・休業日の扱い・前後予定の決め方の中では、知らない項目はすべてエラー
 */
const TOP_LEVEL_FIELDS = new Set(['format', 'schemaVersion', 'rules']);
const RULE_FIELDS = new Set([
  'title',
  'calendarId',
  'group',
  'note',
  'color',
  'recurrence',
  'adjust',
  'notices',
  'period',
]);
/** アプリ側で付け直すので、あっても読まない項目。 */
const IGNORED_RULE_FIELDS = new Set(['id', 'enabled', 'createdAt', 'updatedAt']);
const NOTICE_FIELDS = new Set(['label', 'timing', 'role', 'calendarId']);

const RECURRENCE_FIELDS: Record<Recurrence['type'], readonly string[]> = {
  weekly: ['type', 'interval', 'weekdays', 'anchor'],
  businessDays: ['type', 'interval', 'anchor'],
  monthlyByDay: ['type', 'interval', 'months', 'days', 'overflow'],
  monthlyByWeekday: ['type', 'interval', 'months', 'nth', 'weekday'],
  monthlyByBusinessDay: ['type', 'interval', 'months', 'nth'],
  fiscalRelative: ['type', 'offsetMonths', 'day'],
};

const TIMING_FIELDS: Record<NoticeTiming['kind'], readonly string[]> = {
  offset: ['kind', 'offset', 'unit', 'onClosed'],
  weekday: ['kind', 'weeks', 'weekday', 'onClosed'],
  monthlyBusinessDay: ['kind', 'months', 'nth'],
};

export const AI_COLORS: readonly ColorToken[] = [
  'blue',
  'green',
  'red',
  'orange',
  'purple',
  'teal',
  'pink',
  'gray',
];
const ADJUST_MODES: readonly AdjustMode[] = ['none', 'prev', 'next', 'nearest', 'both', 'skip'];

/** 第N営業日として指定できる上限。1か月の営業日数を超える指定は意味がない。 */
export const MAX_BUSINESS_NTH = 23;

/** 制御文字。改行などが名前に混ざると表示も書き出しも崩れる。 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export type AiImportContext = {
  /** 選べる営業日カレンダー。利用者の手元にあるものだけを許す。 */
  calendars: readonly BusinessCalendar[];
  /** 作成日時。テストで固定するために受け取る。 */
  now?: Date;
};

export type AiImportResult =
  | { ok: true; rules: Rule[]; issues: AiImportIssue[] }
  | { ok: false; issues: AiImportIssue[] };

/** 値を AI 向けの文に埋め込むときの書き方。長いものは切る。 */
function show(value: unknown): string {
  let text: string;
  try {
    text = value === undefined ? 'undefined' : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

const quoteList = (values: readonly (string | number)[]): string =>
  values.map((value) => (typeof value === 'string' ? `"${value}"` : String(value))).join(' / ');

/** 自分の持ち物だけを読む。__proto__ や constructor を辿らないため。 */
const own = (record: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const has = (record: Record<string, unknown>, key: string): boolean => Object.hasOwn(record, key);

const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

/** 1回の検証で使う、問題の書き留め役。 */
class Collector {
  readonly issues: AiImportIssue[] = [];
  subject: string | undefined;

  error(path: string, message: string, fix: string): void {
    this.push({ severity: 'error', path, message, fix });
  }

  warn(path: string, message: string, fix: string): void {
    this.push({ severity: 'warning', path, message, fix });
  }

  private push(issue: AiImportIssue): void {
    if (this.issues.length >= AI_IMPORT_LIMITS.issues) return;
    this.issues.push(this.subject === undefined ? issue : { ...issue, subject: this.subject });
  }

  get failed(): boolean {
    return this.issues.some((issue) => issue.severity === 'error');
  }
}

/** 決めた項目以外を持っていないか。知らない項目はエラーにする。 */
function rejectUnknown(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  what: string,
  out: Collector,
): void {
  for (const key of Object.keys(record)) {
    if (allowed.includes(key)) continue;
    out.error(
      `${path}.${key}`,
      `AIから返された「${what}」に、このアプリでは使えない項目（${key}）が含まれています。`,
      `${path} に "${key}" は使えません。使える項目は ${quoteList(allowed)} だけです。`,
    );
  }
}

/** 列挙値の検査。利用者には「どの設定が」使えないかを言う。 */
function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  what: string,
  out: Collector,
): T | null {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  if (value === undefined) {
    out.error(path, `AIから返された設定に「${what}」がありません。`, `${path} を ${quoteList(allowed)} のいずれかで指定してください。`);
  } else {
    out.error(
      path,
      `AIから返された「${what}」に、このアプリでは使えない設定（${show(value)}）が含まれています。`,
      `${path} は ${quoteList(allowed)} のいずれかにしてください（${show(value)} は使えません）。`,
    );
  }
  return null;
}

/** 範囲つきの整数。 */
function readInt(
  value: unknown,
  path: string,
  what: string,
  range: { min: number; max: number; notZero?: boolean },
  out: Collector,
): number | null {
  const ok =
    isInt(value) && value >= range.min && value <= range.max && !(range.notZero === true && value === 0);
  if (ok) return value;
  const span = `${range.min} 〜 ${range.max}${range.notZero === true ? '（0 を除く）' : ''}`;
  if (value === undefined) {
    out.error(path, `AIから返された設定に「${what}」がありません。`, `${path} を ${span} の整数で指定してください。`);
  } else {
    out.error(
      path,
      `AIから返された「${what}」の値（${show(value)}）は、このアプリでは使えません。`,
      `${path} は ${span} の整数（数値型）にしてください（${show(value)} は使えません）。`,
    );
  }
  return null;
}

/** 整数の並び。重複は取り除き、小さい順に並べる。 */
function readIntList(
  value: unknown,
  path: string,
  what: string,
  accept: (item: unknown) => boolean,
  allowedText: string,
  out: Collector,
): number[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    out.error(
      path,
      value === undefined
        ? `AIから返された設定に「${what}」がありません。`
        : `AIから返された「${what}」の指定が正しくありません。`,
      `${path} は ${allowedText} を1つ以上並べた配列にしてください。`,
    );
    return null;
  }
  if (value.length > LIMITS.arrayItems) {
    out.error(path, `AIから返された「${what}」の指定が多すぎます。`, `${path} の要素は ${LIMITS.arrayItems} 個までにしてください。`);
    return null;
  }
  const bad = value.filter((item) => !accept(item));
  if (bad.length > 0) {
    out.error(
      path,
      `AIから返された「${what}」に、このアプリでは使えない値（${bad.map(show).join('、')}）が含まれています。`,
      `${path} の要素は ${allowedText} にしてください（${bad.map(show).join(', ')} は使えません）。`,
    );
    return null;
  }
  return [...new Set(value as number[])].sort((a, b) => a - b);
}

function readInterval(record: Record<string, unknown>, path: string, out: Collector): number | null {
  if (!has(record, 'interval')) return 1;
  return readInt(own(record, 'interval'), `${path}.interval`, '間隔', { min: 1, max: LIMITS.interval }, out);
}

function readMonths(record: Record<string, unknown>, path: string, out: Collector): Month[] | undefined | null {
  if (!has(record, 'months')) return undefined;
  const months = readIntList(
    own(record, 'months'),
    `${path}.months`,
    '対象月',
    (item) => isInt(item) && item >= 1 && item <= 12,
    '1 〜 12 の整数',
    out,
  );
  return months === null ? null : (months as Month[]);
}

/** 繰り返しの起点の日付。無ければ undefined、読めなければ null（エラーを書き留める）。 */
function readAnchor(record: Record<string, unknown>, path: string, out: Collector): DateStr | undefined | null {
  if (!has(record, 'anchor')) return undefined;
  const raw = own(record, 'anchor');
  if (typeof raw === 'string' && isValidDateStr(raw)) return raw;
  out.error(
    `${path}.anchor`,
    `AIから返された「繰り返しの基準日」（${show(raw)}）は日付として読めません。`,
    `${path}.anchor は実在する日付を "YYYY-MM-DD" 形式で指定してください。`,
  );
  return null;
}

const isWeekday = (item: unknown): boolean => isInt(item) && item >= 0 && item <= 6;

function readRecurrence(value: unknown, path: string, out: Collector): Recurrence | null {
  if (!isPlainObject(value)) {
    out.error(
      path,
      value === undefined
        ? 'AIから返された予定に「繰り返し方」がありません。'
        : 'AIから返された「繰り返し方」の形式が正しくありません。',
      `${path} をオブジェクトで指定してください（type は ${quoteList(Object.keys(RECURRENCE_FIELDS))} のいずれか）。`,
    );
    return null;
  }
  const type = readEnum(
    own(value, 'type'),
    Object.keys(RECURRENCE_FIELDS) as Recurrence['type'][],
    `${path}.type`,
    '繰り返しの種類',
    out,
  );
  if (type === null) return null;
  rejectUnknown(value, RECURRENCE_FIELDS[type], path, '繰り返し方', out);

  switch (type) {
    case 'businessDays': {
      const interval = readInterval(value, path, out);
      const anchor = readAnchor(value, path, out);
      if (interval === null || anchor === null) return null;
      if (interval >= 2 && anchor === undefined) {
        out.warn(
          `${path}.anchor`,
          '「N営業日ごと」の数え始めの日が指定されていないため、どの日から数えるかはアプリの既定で決まります。下の日付で確かめてください。',
          `${path}.anchor に、数え始める日（"YYYY-MM-DD"）を指定してください。利用者が起点を伝えていなければ、利用者に尋ねてください。`,
        );
      }
      return { type, interval, ...(anchor === undefined ? {} : { anchor }) };
    }
    case 'weekly': {
      const interval = readInterval(value, path, out);
      const weekdays = readIntList(own(value, 'weekdays'), `${path}.weekdays`, '曜日', isWeekday, '0（日）〜 6（土）の整数', out);
      const anchor = readAnchor(value, path, out);
      if (interval === null || weekdays === null || anchor === null) return null;
      if (interval >= 2 && anchor === undefined) {
        out.warn(
          `${path}.anchor`,
          '隔週などの基準日が指定されていないため、どの週から数えるかはアプリの既定で決まります。下の日付で確かめてください。',
          `${path}.anchor に、繰り返しの起点となる週の日付（"YYYY-MM-DD"）を指定してください。利用者が起点を伝えていなければ、利用者に尋ねてください。`,
        );
      }
      return {
        type,
        interval,
        weekdays: weekdays as Weekday[],
        ...(anchor === undefined ? {} : { anchor }),
      };
    }
    case 'monthlyByDay': {
      const interval = readInterval(value, path, out);
      const months = readMonths(value, path, out);
      const rawDays = own(value, 'days');
      const numericDays = Array.isArray(rawDays) ? rawDays.filter((day) => day !== 'last') : rawDays;
      const hasLast = Array.isArray(rawDays) && rawDays.includes('last');
      // "last" だけのときは数値の並びが空になるので、空でも通す。
      const days =
        Array.isArray(numericDays) && numericDays.length === 0 && hasLast
          ? []
          : readIntList(numericDays, `${path}.days`, '日にち', (item) => isInt(item) && item >= 1 && item <= 31, '1 〜 31 の整数または "last"（末日）', out);
      let overflow: 'clamp' | 'skip' = 'clamp';
      if (has(value, 'overflow')) {
        const read = readEnum(own(value, 'overflow'), ['clamp', 'skip'] as const, `${path}.overflow`, '存在しない日（2月30日など）の扱い', out);
        if (read === null) return null;
        overflow = read;
      }
      if (interval === null || months === null || days === null) return null;
      return {
        type,
        interval,
        ...(months === undefined ? {} : { months }),
        days: hasLast ? [...days, 'last'] : days,
        overflow,
      };
    }
    case 'monthlyByWeekday': {
      const interval = readInterval(value, path, out);
      const months = readMonths(value, path, out);
      const nth = readIntList(
        own(value, 'nth'),
        `${path}.nth`,
        '第何週か',
        (item) => item === -1 || (isInt(item) && item >= 1 && item <= 5),
        '1 〜 5 の整数または -1（最終）',
        out,
      );
      const weekday = readInt(own(value, 'weekday'), `${path}.weekday`, '曜日', { min: 0, max: 6 }, out);
      if (interval === null || months === null || nth === null || weekday === null) return null;
      return {
        type,
        interval,
        ...(months === undefined ? {} : { months }),
        nth: nth as (1 | 2 | 3 | 4 | 5 | -1)[],
        weekday: weekday as Weekday,
      };
    }
    case 'monthlyByBusinessDay': {
      const interval = readInterval(value, path, out);
      const months = readMonths(value, path, out);
      const nth = readIntList(
        own(value, 'nth'),
        `${path}.nth`,
        '第何営業日か',
        (item) => isInt(item) && item !== 0 && Math.abs(item) <= MAX_BUSINESS_NTH,
        `1 〜 ${MAX_BUSINESS_NTH}（月初から）または -1 〜 -${MAX_BUSINESS_NTH}（月末から。-1 が最終営業日）の整数`,
        out,
      );
      if (interval === null || months === null || nth === null) return null;
      return { type, interval, ...(months === undefined ? {} : { months }), nth };
    }
    case 'fiscalRelative': {
      const offsetMonths = readIntList(
        own(value, 'offsetMonths'),
        `${path}.offsetMonths`,
        '決算月からのずれ',
        (item) => isInt(item) && Math.abs(item) <= 24,
        '-24 〜 24 の整数',
        out,
      );
      const rawDay = own(value, 'day');
      const day = rawDay === 'last' ? 'last' : readInt(rawDay, `${path}.day`, '日にち', { min: 1, max: 31 }, out);
      if (offsetMonths === null || day === null) return null;
      return { type, offsetMonths, day };
    }
  }
}

function readAdjust(value: unknown, recurrence: Recurrence | null, path: string, out: Collector): Adjustment | null {
  // 第N営業日・毎営業日は定義上すでに営業日なので、休業日の扱いは効かない。編集画面と同じく none に均す。
  const ignored = recurrence?.type === 'monthlyByBusinessDay' || recurrence?.type === 'businessDays';
  if (value === undefined) {
    if (ignored) return { mode: 'none', keepInMonth: false };
    out.error(
      path,
      'AIから返された予定に「休業日にあたったときの扱い」がありません。',
      `${path} を指定してください（mode は ${quoteList(ADJUST_MODES)} のいずれか）。利用者が扱いを伝えていなければ、利用者に尋ねてください。`,
    );
    return null;
  }
  if (!isPlainObject(value)) {
    out.error(path, 'AIから返された「休業日の扱い」の形式が正しくありません。', `${path} は { "mode": ..., "keepInMonth": ... } の形のオブジェクトにしてください。`);
    return null;
  }
  rejectUnknown(value, ['mode', 'keepInMonth'], path, '休業日の扱い', out);
  const mode = readEnum(own(value, 'mode'), ADJUST_MODES, `${path}.mode`, '休業日の扱い', out);
  let keepInMonth = false;
  if (has(value, 'keepInMonth')) {
    const raw = own(value, 'keepInMonth');
    if (typeof raw === 'boolean') keepInMonth = raw;
    else {
      out.error(`${path}.keepInMonth`, 'AIから返された「月をまたがないようにするか」の指定が正しくありません。', `${path}.keepInMonth は true または false（真偽値）にしてください。`);
      return null;
    }
  }
  if (mode === null) return null;
  if (ignored) {
    if (mode !== 'none') {
      out.warn(
        `${path}.mode`,
        '「第N営業日」「毎営業日」は必ず営業日になるため、休業日の扱いは使いません。',
        `type が "${recurrence?.type ?? ''}" のときは ${path}.mode を "none" にしてください。`,
      );
    }
    return { mode: 'none', keepInMonth: false };
  }
  return { mode, keepInMonth };
}

function readTiming(value: unknown, path: string, out: Collector): NoticeTiming | null {
  if (!isPlainObject(value)) {
    out.error(
      path,
      value === undefined
        ? 'AIから返された前後の予定に「日付の決め方」がありません。'
        : 'AIから返された前後の予定の「日付の決め方」の形式が正しくありません。',
      `${path} をオブジェクトで指定してください（kind は ${quoteList(Object.keys(TIMING_FIELDS))} のいずれか）。`,
    );
    return null;
  }
  const kind = readEnum(
    own(value, 'kind'),
    Object.keys(TIMING_FIELDS) as NoticeTiming['kind'][],
    `${path}.kind`,
    '前後の予定の日付の決め方',
    out,
  );
  if (kind === null) return null;
  rejectUnknown(value, TIMING_FIELDS[kind], path, '前後の予定の日付の決め方', out);

  switch (kind) {
    case 'offset': {
      const offset = readInt(own(value, 'offset'), `${path}.offset`, '本体から何日前・何日後か', { min: -LIMITS.noticeOffset, max: LIMITS.noticeOffset, notZero: true }, out);
      const unit = readEnum(own(value, 'unit'), ['business', 'calendar'] as const, `${path}.unit`, '日数の数え方（営業日／暦日）', out);
      let onClosed: 'next' | 'prev' | 'none' | undefined;
      if (has(value, 'onClosed')) {
        const read = readEnum(own(value, 'onClosed'), ['next', 'prev', 'none'] as const, `${path}.onClosed`, '数えた先が休業日のときの扱い', out);
        if (read === null) return null;
        onClosed = read;
      }
      if (offset === null || unit === null) return null;
      if (onClosed !== undefined && unit === 'business') {
        // 営業日で数えた先は必ず営業日なので効かない。意味は変わらないので落として知らせる。
        out.warn(
          `${path}.onClosed`,
          '営業日で数える前後の予定は必ず営業日になるため、「休業日のときの扱い」は使いません。',
          `${path}.unit が "business" のときは onClosed を出力しないでください。`,
        );
        onClosed = undefined;
      }
      return { kind, offset, unit, ...(onClosed === undefined ? {} : { onClosed }) };
    }
    case 'weekday': {
      const weeks = readInt(own(value, 'weeks'), `${path}.weeks`, '何週前・何週後か', { min: -LIMITS.noticeWeeks, max: LIMITS.noticeWeeks }, out);
      const weekday = readInt(own(value, 'weekday'), `${path}.weekday`, '曜日', { min: 0, max: 6 }, out);
      const onClosed = readEnum(own(value, 'onClosed'), ['next', 'prev', 'none'] as const, `${path}.onClosed`, 'その曜日が休業日のときの扱い', out);
      if (weeks === null || weekday === null || onClosed === null) return null;
      return { kind, weeks, weekday: weekday as Weekday, onClosed };
    }
    case 'monthlyBusinessDay': {
      const months = readInt(own(value, 'months'), `${path}.months`, '何か月前・何か月後か', { min: -LIMITS.noticeMonths, max: LIMITS.noticeMonths }, out);
      const nth = readInt(own(value, 'nth'), `${path}.nth`, '第何営業日か', { min: -LIMITS.noticeNth, max: LIMITS.noticeNth, notZero: true }, out);
      if (months === null || nth === null) return null;
      return { kind, months, nth };
    }
  }
}

/** 名前の類。空・長すぎ・制御文字を弾く。 */
function readText(
  value: unknown,
  path: string,
  what: string,
  maxLength: number,
  required: boolean,
  out: Collector,
): string | null | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    out.error(
      path,
      value === undefined ? `AIから返された予定に「${what}」がありません。` : `AIから返された「${what}」が空か、文字ではありません。`,
      `${path} を空でない文字列で指定してください。`,
    );
    return null;
  }
  if (value.length > maxLength) {
    out.error(path, `AIから返された「${what}」が長すぎます（${maxLength}文字まで）。`, `${path} は ${maxLength} 文字以内にしてください。`);
    return null;
  }
  if (CONTROL_CHARS.test(value)) {
    out.error(path, `AIから返された「${what}」に、改行などの使えない文字が含まれています。`, `${path} には改行や制御文字を含めないでください。`);
    return null;
  }
  return value.trim();
}

function readNotices(
  value: unknown,
  path: string,
  calendars: readonly BusinessCalendar[],
  out: Collector,
): Notice[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    out.error(path, 'AIから返された「前後の予定」の形式が正しくありません。', `${path} は配列にしてください（無ければ [] か省略）。`);
    return null;
  }
  if (value.length > LIMITS.notices) {
    out.error(path, `AIから返された前後の予定が多すぎます（1件の予定につき ${LIMITS.notices} 件まで）。`, `${path} は ${LIMITS.notices} 件以内にしてください。`);
    return null;
  }
  const notices: Notice[] = [];
  let failed = false;
  value.forEach((item: unknown, index) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(item)) {
      out.error(at, 'AIから返された前後の予定の形式が正しくありません。', `${at} は { "label": ..., "timing": {...} } の形のオブジェクトにしてください。`);
      failed = true;
      return;
    }
    rejectUnknown(item, [...NOTICE_FIELDS], at, '前後の予定', out);
    const label = readText(own(item, 'label'), `${at}.label`, '前後の予定の名前', LIMITS.titleLength, true, out);
    const timing = readTiming(own(item, 'timing'), `${at}.timing`, out);
    let role: NoticeRole | undefined;
    if (has(item, 'role')) {
      const read = readEnum(own(item, 'role'), ['before', 'after'] as const, `${at}.role`, '本体の前か後か', out);
      if (read === null) failed = true;
      else role = read;
    }
    let calendarId: string | undefined;
    if (has(item, 'calendarId')) {
      const raw = own(item, 'calendarId');
      const ids = calendars.map((calendar) => calendar.id);
      if (typeof raw === 'string' && ids.includes(raw)) calendarId = raw;
      else {
        out.error(
          `${at}.calendarId`,
          `AIから返された前後の予定の営業日カレンダー（${show(raw)}）はこのアプリにありません。`,
          `${at}.calendarId は ${quoteList(ids)} のいずれかにしてください（本体と同じなら省略）。`,
        );
        failed = true;
      }
    }
    if (typeof label !== 'string' || timing === null) {
      failed = true;
      return;
    }
    notices.push({
      label,
      timing,
      ...(role === undefined ? {} : { role }),
      ...(calendarId === undefined ? {} : { calendarId }),
    });
  });
  return failed ? null : notices;
}

function readPeriod(value: unknown, path: string, out: Collector): Rule['period'] | null {
  if (value === undefined) return { start: null, end: null };
  if (!isPlainObject(value)) {
    out.error(path, 'AIから返された「有効期間」の形式が正しくありません。', `${path} は { "start": ..., "end": ... } の形にしてください（無期限なら省略）。`);
    return null;
  }
  rejectUnknown(value, ['start', 'end'], path, '有効期間', out);
  const read = (key: 'start' | 'end', what: string): DateStr | null | false => {
    const raw = own(value, key);
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'string' && isValidDateStr(raw)) return raw;
    out.error(`${path}.${key}`, `AIから返された「${what}」（${show(raw)}）は日付として読めません。`, `${path}.${key} は実在する日付を "YYYY-MM-DD" 形式で指定するか、null にしてください。`);
    return false;
  };
  const start = read('start', '有効期間の開始日');
  const end = read('end', '有効期間の終了日');
  if (start === false || end === false) return null;
  if (start !== null && end !== null && start > end) {
    out.error(path, 'AIから返された有効期間は、開始日が終了日より後になっています。', `${path}.start は ${path}.end 以前の日付にしてください。`);
    return null;
  }
  return { start, end };
}

function readRule(value: unknown, index: number, ctx: AiImportContext, out: Collector): Rule | null {
  const path = `rules[${index}]`;
  out.subject = `${index + 1}件目`;
  if (!isPlainObject(value)) {
    out.error(path, 'AIから返された予定の形式が正しくありません。', `${path} はオブジェクトにしてください。`);
    return null;
  }
  const rawTitle = own(value, 'title');
  if (typeof rawTitle === 'string' && rawTitle.trim() !== '') {
    out.subject = `${index + 1}件目「${rawTitle.trim().slice(0, 40)}」`;
  }

  for (const key of Object.keys(value)) {
    if (RULE_FIELDS.has(key)) continue;
    if (IGNORED_RULE_FIELDS.has(key)) {
      out.warn(
        `${path}.${key}`,
        `「${key}」はアプリ側で決めるため、AIから返された値は使いません。`,
        `${path}.${key} は出力しないでください。`,
      );
      continue;
    }
    out.error(
      `${path}.${key}`,
      `AIから返された予定に、このアプリでは使えない項目（${key}）が含まれています。意味が変わるおそれがあるため読み込みません。`,
      `${path} に "${key}" は使えません。使える項目は ${quoteList([...RULE_FIELDS])} だけです。`,
    );
  }

  const title = readText(rawTitle, `${path}.title`, '予定の名前', LIMITS.titleLength, true, out);
  const group = readText(own(value, 'group'), `${path}.group`, 'グループ', LIMITS.groupLength, false, out);
  const rawNote = own(value, 'note');
  let note: string | undefined;
  if (rawNote !== undefined) {
    // メモは改行を許す。長さと型だけを見る。
    if (typeof rawNote !== 'string' || rawNote.length > LIMITS.noteLength) {
      out.error(`${path}.note`, `AIから返された「メモ」が文字ではないか、長すぎます（${LIMITS.noteLength}文字まで）。`, `${path}.note は ${LIMITS.noteLength} 文字以内の文字列にしてください。`);
    } else if (rawNote.trim() !== '') note = rawNote.trim();
  }

  const calendarIds = ctx.calendars.map((calendar) => calendar.id);
  let calendarId = calendarIds[0] ?? 'company';
  if (has(value, 'calendarId')) {
    const raw = own(value, 'calendarId');
    if (typeof raw === 'string' && calendarIds.includes(raw)) calendarId = raw;
    else {
      const names = ctx.calendars.map((calendar) => `「${calendar.name}」`).join('か');
      out.error(
        `${path}.calendarId`,
        `AIから返された営業日カレンダー（${show(raw)}）はこのアプリにありません。${names}のどちらで数えるかを指定してもらってください。`,
        `${path}.calendarId は ${quoteList(calendarIds)} のいずれかにしてください（${show(raw)} はありません）。`,
      );
    }
  }

  let color: ColorToken = 'blue';
  if (has(value, 'color')) {
    const read = readEnum(own(value, 'color'), AI_COLORS, `${path}.color`, '色', out);
    if (read !== null) color = read;
  }

  const recurrence = readRecurrence(own(value, 'recurrence'), `${path}.recurrence`, out);
  const adjust = readAdjust(own(value, 'adjust'), recurrence, `${path}.adjust`, out);
  const notices = readNotices(own(value, 'notices'), `${path}.notices`, ctx.calendars, out);
  const period = readPeriod(own(value, 'period'), `${path}.period`, out);

  if (
    typeof title !== 'string' ||
    group === null ||
    recurrence === null ||
    adjust === null ||
    notices === null ||
    period === null
  ) {
    return null;
  }

  const now = (ctx.now ?? new Date()).toISOString();
  // 既定値はアプリが持つものを使い、AI が言ったことだけを上書きする。
  // id は必ずこちらで作る。AI に決めさせると既存のルールと衝突しうる。
  const rule = normalizeRule({
    ...createRule(),
    title,
    color,
    ...(group === undefined ? {} : { group }),
    ...(note === undefined ? {} : { note }),
    enabled: true,
    calendarId,
    recurrence,
    adjust,
    notices,
    period,
    skipDates: [],
    createdAt: now,
    updatedAt: now,
  });

  // 最後に、保存されているルールと同じ検証を通す。ここを通らないものは
  // 編集画面でも保存できないので、取り込みでも通さない。
  for (const issue of validateRule(rule)) {
    if (issue.severity !== 'error') continue;
    out.error(`${path}.${issue.path}`, `AIから返された予定に問題があります: ${issue.message}`, `${path}.${issue.path}: ${issue.message}`);
  }
  return rule;
}

/**
 * 取り出した JSON を確かめ、このアプリのルールに組み直す。
 *
 * 1件でもエラーがあれば何も返さない（一部だけ取り込むと、組になっている予定の
 * 片方だけが登録されて気づきにくい）。警告は登録を止めない。
 */
export function validateAiImport(value: unknown, ctx: AiImportContext): AiImportResult {
  const out = new Collector();

  if (!isPlainObject(value)) {
    out.error(
      '',
      'AIから返された内容は、このアプリ用の設定データの形になっていません。',
      `一番外側を { "format": "${AI_IMPORT_FORMAT}", "schemaVersion": ${AI_IMPORT_SCHEMA_VERSION}, "rules": [...] } の形のオブジェクトにしてください。`,
    );
    return { ok: false, issues: out.issues };
  }

  const format = own(value, 'format');
  if (format !== AI_IMPORT_FORMAT) {
    out.error(
      'format',
      format === undefined
        ? 'このアプリ用の設定データであることを示す印（format）がありません。依頼文を最初から貼り付けて作り直してもらってください。'
        : 'このアプリ用の設定データではありません。バックアップのファイルは〈設定〉の〈インポート〉から読み込んでください。',
      `"format" は "${AI_IMPORT_FORMAT}" にしてください。`,
    );
  }
  const version = own(value, 'schemaVersion');
  if (version !== AI_IMPORT_SCHEMA_VERSION) {
    out.error(
      'schemaVersion',
      isInt(version) && version > AI_IMPORT_SCHEMA_VERSION
        ? 'このアプリより新しい形式の設定データです。アプリを最新にしてからお試しください。'
        : '設定データの版（schemaVersion）が正しくありません。',
      `"schemaVersion" は数値の ${AI_IMPORT_SCHEMA_VERSION} にしてください。`,
    );
  }
  for (const key of Object.keys(value)) {
    if (TOP_LEVEL_FIELDS.has(key)) continue;
    out.warn(key, `「${key}」はこのアプリでは使わないため、無視しました。`, `一番外側に "${key}" は不要です。`);
  }

  const rules = own(value, 'rules');
  if (!Array.isArray(rules)) {
    out.error('rules', 'AIから返された内容に、予定の一覧（rules）がありません。', '"rules" に予定を並べた配列を入れてください。');
    return { ok: false, issues: out.issues };
  }
  if (rules.length === 0) {
    out.error('rules', 'AIから返された内容に、予定が1件も含まれていません。', '"rules" に予定を1件以上入れてください。作りたい予定が分からなければ、利用者に尋ねてください。');
    return { ok: false, issues: out.issues };
  }
  if (rules.length > AI_IMPORT_LIMITS.rules) {
    out.error(
      'rules',
      `一度に取り込める予定は ${AI_IMPORT_LIMITS.rules} 件までです（${rules.length} 件ありました）。何回かに分けて作ってもらってください。`,
      `"rules" は ${AI_IMPORT_LIMITS.rules} 件以内にしてください。`,
    );
    return { ok: false, issues: out.issues };
  }
  // 形が違うときは中身を見ても的外れな指摘になるので、ここで止める。
  if (out.failed) return { ok: false, issues: out.issues };

  const built = rules.map((rule, index) => readRule(rule, index, ctx, out));
  out.subject = undefined;
  if (out.failed) return { ok: false, issues: out.issues };
  return { ok: true, rules: built.filter((rule): rule is Rule => rule !== null), issues: out.issues };
}

/** 貼り付けた回答を読む。取り出しと検証をまとめたもの。 */
export function readAiReply(input: string, ctx: AiImportContext): AiImportResult {
  const parsed = parseAiReply(input);
  if (!parsed.ok) return { ok: false, issues: [parsed.issue] };
  return validateAiImport(parsed.value, ctx);
}

// ---------------------------------------------------------------------------
// 3. 確認用のプレビュー
// ---------------------------------------------------------------------------

export type ImportPreviewItem = {
  rule: Rule;
  /** 「毎月25日 / 休業日なら前営業日」のような1行。ルール一覧と同じ言い方。 */
  summary: string;
  calendarName: string;
  /** 「3営業日前: 振込データ作成」の並び。 */
  notices: string[];
  /** 有効期間。無期限なら空文字。 */
  period: string;
  /**
   * 直近の回。**AI の返した値ではなく、編集画面と同じ営業日計算で求める。**
   * AI に日付を言わせて見せると、計算違いをそのまま信じさせてしまう。
   */
  series: PreviewSeries[];
};

export const IMPORT_PREVIEW_COUNT = 3;

export function buildImportPreview(
  rules: readonly Rule[],
  calendars: readonly BusinessCalendar[],
  ctx: ScheduleContext,
  from: DateStr,
  count = IMPORT_PREVIEW_COUNT,
): ImportPreviewItem[] {
  return rules.map((rule) => ({
    rule,
    summary: describeRule(rule),
    calendarName: calendars.find((calendar) => calendar.id === rule.calendarId)?.name ?? rule.calendarId,
    notices: rule.notices.map(
      (notice) =>
        `${describeTiming(timingOf(notice))}: ${notice.label}${describeNoticeCalendar(
          notice,
          rule.calendarId,
          (id) => calendars.find((calendar) => calendar.id === id)?.name,
        )}`,
    ),
    period: describePeriod(rule.period),
    series: previewSeries(rule, from, count, ctx),
  }));
}

// ---------------------------------------------------------------------------
// 4. 登録
// ---------------------------------------------------------------------------

/**
 * 取り込んだルールを、既存のルールの後ろへ足す。
 *
 * 既存のルールには一切触れない（同じ参照のまま返す）。id が重なったときは
 * 取り込む側を付け直す。上書きにすると、利用者が作ったルールが消える。
 */
export function appendImportedRules(saved: readonly Rule[], incoming: readonly Rule[]): Rule[] {
  const used = new Set(saved.map((rule) => rule.id));
  const added = incoming.map((rule) => {
    let id = rule.id;
    while (used.has(id)) id = newRuleId();
    used.add(id);
    return id === rule.id ? rule : { ...rule, id };
  });
  return [...saved, ...added];
}
