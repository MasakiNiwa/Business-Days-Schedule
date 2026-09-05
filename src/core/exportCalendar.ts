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

import { dayOf, monthOf, addDays, yearOf } from './dateUtil';
import { describeRule } from './describe';
import type { DateStr, Occurrence, Rule } from '../types';

export type CalendarExportFormat = 'ics' | 'csv';

export type CalendarExportOptions = {
  /** 事前通知（準備日）も予定として書き出すか。 */
  includeNotices: boolean;
  /** 取り込み先で表示されるカレンダー名。 */
  calendarName: string;
};

const PRODUCT_ID = '-//Business Days Schedule//JA//';
/** UID の名前空間。同じ予定を再取り込みしたときに重複ではなく更新として扱わせる。 */
const UID_DOMAIN = 'business-days-schedule';

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** "2026-10-23" → "20261023" */
function toBasicDate(date: DateStr): string {
  return `${yearOf(date)}${pad2(monthOf(date))}${pad2(dayOf(date))}`;
}

/** 予定の説明文。補正の由来を残すことが、この書き出しの主な価値になる。 */
export function describeOccurrence(occurrence: Occurrence, rule: Rule): string {
  const lines: string[] = [];
  if (occurrence.kind === 'notice') {
    lines.push(`${occurrence.rawDate} の予定に対する事前準備`);
  } else if (occurrence.shifted) {
    lines.push(
      `本来は ${occurrence.rawDate}（休業日）。${
        occurrence.shiftDirection === 'prev' ? '前営業日へ前倒し' : '翌営業日へ後ろ倒し'
      }。`,
    );
  }
  lines.push(describeRule(rule));
  if (rule.note !== undefined && rule.note !== '') lines.push(rule.note);
  return lines.join('\n');
}

export function titleOf(occurrence: Occurrence, rule: Rule): string {
  return occurrence.kind === 'notice'
    ? `${rule.title}: ${occurrence.noticeLabel ?? '準備'}`
    : rule.title;
}

type Entry = { occurrence: Occurrence; rule: Rule };

function collectEntries(
  occurrences: readonly Occurrence[],
  rules: ReadonlyMap<string, Rule>,
  options: CalendarExportOptions,
): Entry[] {
  const entries: Entry[] = [];
  for (const occurrence of occurrences) {
    if (!options.includeNotices && occurrence.kind === 'notice') continue;
    const rule = rules.get(occurrence.ruleId);
    if (rule === undefined) continue;
    entries.push({ occurrence, rule });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// iCalendar
// ---------------------------------------------------------------------------

/** TEXT 値のエスケープ（RFC 5545 §3.3.11）。 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
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
    // 同じ予定を再取り込みしたときに重複しないよう、UID は内容から決まる形にする。
    const base = `${rule.id}-${occurrence.kind}-${occurrence.date}`;
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
      'TRANSP:TRANSPARENT',
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

export function exportCalendarFileName(
  from: DateStr,
  to: DateStr,
  format: CalendarExportFormat,
): string {
  return `business-days-${from.replace(/-/g, '')}-${to.replace(/-/g, '')}.${format}`;
}

export const MIME_TYPES: Record<CalendarExportFormat, string> = {
  ics: 'text/calendar;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
};
