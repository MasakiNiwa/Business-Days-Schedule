/**
 * 外部カレンダー（Google カレンダー / Outlook など）へ取り込むための書き出し。
 *
 * 反復ルールをそのまま渡すことはせず、指定期間の発生日へ展開した「単発の予定」の
 * 集まりとして出す。営業日補正は他所のカレンダーには再現できないため、
 * こちらで確定させた日付を渡すのが唯一正しく伝わる方法である。
 *
 * 形式は2つ。
 *   ics … iCalendar。Google・Outlook・Apple いずれも読める。既定はこちら
 *   csv … Google カレンダーの CSV 取り込み用。表計算で中身を確かめたいとき向け
 */

import { APP_NAME } from './buildInfo';
import { dayOf, monthOf, addDays, weekdayOf, yearOf } from './dateUtil';
import { describeRule } from './describe';
import type { DateStr, Occurrence, Rule } from '../types';

export type CalendarExportFormat = 'ics' | 'csv';

export type CalendarExportOptions = {
  /** 準備日（本体より前）も予定として書き出すか。 */
  includeNotices: boolean;
  /**
   * フォロー（本体より後）も書き出すか。
   * 準備日と別に持つのは、片方だけ要ることがあるため。
   * 省略時は準備日と同じ扱いにする（既存の呼び出しを壊さない）。
   */
  includeFollows?: boolean;
  /** 取り込み先で表示されるカレンダー名。 */
  calendarName: string;
};

const PRODUCT_ID = '-//Business Days Schedule//JA//';
/** UID の名前空間。同じ予定を再取り込みしたときに重複ではなく更新として扱わせる。 */
const UID_DOMAIN = 'business-days-schedule';

/**
 * 取り込み先で付く分類名。Outlook では色分けと絞り込みに使え、
 * 「試しに入れた予定をまとめて消す」ときの手掛かりにもなる。
 * 画面に出る名前と同じにする。別々に書くとどちらかだけ直し忘れる。
 */
export const EXPORT_CATEGORY = APP_NAME;

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** "2026-01-25（日）" 。取り込み先では曜日が出ないことがあるので自分で添える。 */
function withWeekday(date: DateStr): string {
  return `${date}（${WEEKDAY_NAMES[weekdayOf(date)] ?? '?'}）`;
}

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** "2026-10-23" → "20261023" */
function toBasicDate(date: DateStr): string {
  return `${yearOf(date)}${pad2(monthOf(date))}${pad2(dayOf(date))}`;
}

/**
 * 予定の説明文。補正の由来を残すことが、この書き出しの主な価値になる。
 *
 * 取り込み先では本文が1行に潰れて表示されることがあるので、
 * 「見出し: 中身」の形で頭から読めるようにする。
 */
export function describeOccurrence(occurrence: Occurrence, rule: Rule): string {
  const lines: string[] = [];
  if (occurrence.kind !== 'main') {
    // 前に置く準備日か、後ろに置くフォローかで、対象との関係が逆になる。
    const relation = occurrence.kind === 'follow' ? 'の後の予定' : 'の準備';
    lines.push(`対象: ${withWeekday(occurrence.rawDate)}の「${rule.title}」${relation}`);
  } else if (occurrence.shifted) {
    lines.push(
      `補正: 本来は ${withWeekday(occurrence.rawDate)}（休業日）。${
        occurrence.shiftDirection === 'prev' ? '前営業日へ繰り上げ' : '翌営業日へ繰り下げ'
      }`,
    );
  }
  lines.push(`ルール: ${describeRule(rule)}`);
  if (rule.note !== undefined && rule.note !== '') lines.push(`メモ: ${rule.note}`);
  return lines.join('\n');
}

/**
 * 件名。取り込み先の月表示では先頭の数文字しか見えないことが多いので、
 * 予定の名前を頭に置き、補足は後ろへ回す。
 *
 *   給与支払            そのままの日
 *   給与支払（繰上）     休業日に当たって前営業日へ動いた
 *   給与支払（繰下）     休業日に当たって翌営業日へ動いた
 *   【振込データ作成】給与支払   準備日（本体より前）
 *   【入金消込】給与支払         フォロー（本体より後）
 */
export function titleOf(occurrence: Occurrence, rule: Rule): string {
  if (occurrence.kind !== 'main') {
    const fallback = occurrence.kind === 'follow' ? 'フォロー' : '準備';
    return `【${occurrence.noticeLabel ?? fallback}】${rule.title}`;
  }
  if (!occurrence.shifted) return rule.title;
  return `${rule.title}（${occurrence.shiftDirection === 'prev' ? '繰上' : '繰下'}）`;
}

type Entry = { occurrence: Occurrence; rule: Rule };

function collectEntries(
  occurrences: readonly Occurrence[],
  rules: ReadonlyMap<string, Rule>,
  options: CalendarExportOptions,
): Entry[] {
  const entries: Entry[] = [];
  for (const occurrence of occurrences) {
    if (occurrence.kind === 'notice' && !options.includeNotices) continue;
    if (occurrence.kind === 'follow' && !(options.includeFollows ?? options.includeNotices)) continue;
    const rule = rules.get(occurrence.ruleId);
    if (rule === undefined) continue;
    entries.push({ occurrence, rule });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// iCalendar
// ---------------------------------------------------------------------------

/**
 * TEXT 値のエスケープ（RFC 5545 §3.3.11）。
 * セミコロンの置換先は '\\;'（バックスラッシュ＋セミコロン）でなければならない。
 * '\;' は JavaScript では単なる ';' になり、置換が無効になる。
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * 1行を75オクテットで折り返す（RFC 5545 §3.1）。
 * 日本語では1文字が3オクテットになるため、文字数ではなくバイト数で数える必要がある。
 * マルチバイト文字の途中では折らない。
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  // 継続行は先頭に空白が1オクテット入るぶん、2行目以降の上限は74になる。
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74;
    }
    current += char;
    bytes += size;
  }
  if (current !== '') parts.push(current);
  return parts.join('\r\n ');
}

function icsTimestamp(now: Date): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

export function buildIcs(
  occurrences: readonly Occurrence[],
  rules: ReadonlyMap<string, Rule>,
  options: CalendarExportOptions,
  now: Date = new Date(),
): string {
  const stamp = icsTimestamp(now);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
  ];

  const usedUids = new Map<string, number>();

  for (const { occurrence, rule } of collectEntries(occurrences, rules, options)) {
    // UID は「補正前の基準日」から作る。確定日を使うと、祝日データの更新で
    // 日付が動いたときに別の予定として二重に取り込まれてしまうため。
    const parts = [
      rule.id,
      occurrence.kind,
      occurrence.baseDate,
      // 単一予定の識別子は、休日変更による補正の有無・方向に依存させない。
      // 両側補正のときだけ2系列を区別する。子（準備日・フォロー）は自身が
      // 動いていないので、親から引き継いだ seriesDirection を使う。
      // shiftDirection を見ると子が全部同じ値になり、書き出す期間によって
      // 連番の割り当てが変わってしまう（別の予定を上書きしうる）。
      rule.adjust.mode === 'both' ? (occurrence.seriesDirection ?? 'prev') : 'single',
      occurrence.noticeIndex === undefined ? '' : `n${occurrence.noticeIndex}`,
    ].filter((part) => part !== '');
    const base = parts.join('-');
    const seen = usedUids.get(base) ?? 0;
    usedUids.set(base, seen + 1);
    const uid = `${base}${seen === 0 ? '' : `-${seen}`}@${UID_DOMAIN}`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      // 終日予定。DTEND は排他的なので翌日を指定する。
      `DTSTART;VALUE=DATE:${toBasicDate(occurrence.date)}`,
      `DTEND;VALUE=DATE:${toBasicDate(addDays(occurrence.date, 1))}`,
      `SUMMARY:${escapeIcsText(titleOf(occurrence, rule))}`,
      `DESCRIPTION:${escapeIcsText(describeOccurrence(occurrence, rule))}`,
      `CATEGORIES:${escapeIcsText(EXPORT_CATEGORY)}`,
      'STATUS:CONFIRMED',
      // 予定は「時間を埋めるもの」ではなく目印なので、空き時間として入れる。
      'TRANSP:TRANSPARENT',
      // Outlook は TRANSP を見ないため、同じことを Outlook 用の項目でも伝える。
      'X-MICROSOFT-CDO-BUSYSTATUS:FREE',
      'X-MICROSOFT-CDO-ALLDAYEVENT:TRUE',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  // iCalendar の改行は CRLF。
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// CSV（Google カレンダー取り込み形式）
// ---------------------------------------------------------------------------

const CSV_HEADER = [
  'Subject',
  'Start Date',
  'Start Time',
  'End Date',
  'End Time',
  'All Day Event',
  'Description',
  'Location',
  'Private',
];

export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Google カレンダーの CSV は M/D/YYYY を期待する。 */
export function toCsvDate(date: DateStr): string {
  return `${monthOf(date)}/${dayOf(date)}/${yearOf(date)}`;
}

export function buildCsv(
  occurrences: readonly Occurrence[],
  rules: ReadonlyMap<string, Rule>,
  options: CalendarExportOptions,
): string {
  const rows: string[] = [CSV_HEADER.join(',')];

  for (const { occurrence, rule } of collectEntries(occurrences, rules, options)) {
    const date = toCsvDate(occurrence.date);
    rows.push(
      [
        titleOf(occurrence, rule),
        date,
        '',
        date,
        '',
        'True',
        describeOccurrence(occurrence, rule).replace(/\n/g, ' / '),
        '',
        'False',
      ]
        .map(escapeCsvField)
        .join(','),
    );
  }

  // 表計算ソフトで開いたときに文字化けしないよう BOM を付ける。
  // Google カレンダーの取り込みは BOM 付きでも問題なく読める。
  return `﻿${rows.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// ファイル名
// ---------------------------------------------------------------------------

/**
 * ファイル名に混ぜられる形へ均す。
 * グループ名は自由入力なので、そのまま入れると保存できない名前になりうる。
 * 記号や空白を落とし、残らなければ名前に足さない。
 */
function fileNameSafe(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function exportCalendarFileName(
  from: DateStr,
  to: DateStr,
  format: CalendarExportFormat,
  group: string | null = null,
): string {
  const period = `${from.replace(/-/g, '')}-${to.replace(/-/g, '')}`;
  // グループごとに書き出すと同じ期間のファイルが並ぶ。名前で見分けられるようにする。
  const suffix = group === null ? '' : fileNameSafe(group);
  return `business-days-${period}${suffix === '' ? '' : `-${suffix}`}.${format}`;
}

export const MIME_TYPES: Record<CalendarExportFormat, string> = {
  ics: 'text/calendar;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
};
