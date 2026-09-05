/**
 * 外部カレンダーへの書き出し（docs/SPEC.md §9.4）。
 *
 * 取り込み先で崩れると気づきにくいので、RFC 5545 の折り返しとエスケープ、
 * 終日予定の DTEND、UID の安定性をここで固定する。
 */

import { describe, expect, it } from 'vitest';
import {
  buildCsv,
  buildIcs,
  describeOccurrence,
  escapeCsvField,
  escapeIcsText,
  exportCalendarFileName,
  foldIcsLine,
  toCsvDate,
} from '../src/core/exportCalendar';
import { expandRules } from '../src/core/schedule';
import type { Occurrence, Rule } from '../src/types';
import { makeRule, scheduleContext } from './helpers';

const NOW = new Date('2026-09-05T01:23:45Z');
const OPTIONS = { includeNotices: true, calendarName: '営業日スケジュール' };

const salary = makeRule({
  id: 'salary',
  title: '給与振込',
  calendarId: 'bank',
  note: '支給日',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
  notices: [{ offset: -3, unit: 'business', label: '振込データ作成' }],
});

function occurrencesOf(rules: Rule[], start: string, end: string): Occurrence[] {
  return expandRules(rules, { start, end }, scheduleContext).occurrences;
}

const rulesMap = (rules: Rule[]): Map<string, Rule> =>
  new Map(rules.map((rule) => [rule.id, rule]));

/** 折り返しを戻す。取り込み先はこの形で読むので、内容の検証はこちらで行う。 */
const unfold = (ics: string): string => ics.split('\r\n ').join('');

describe('escapeIcsText', () => {
  it('RFC 5545 の特殊文字を退避する', () => {
    // 入力 a,b;c\d → 出力 a\,b\;c\\d
    expect(escapeIcsText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d');
    expect(escapeIcsText('1行目\n2行目')).toBe('1行目\\n2行目');
  });

  it('セミコロンにバックスラッシュを付ける', () => {
    // '\;' は JavaScript では ';' になるため、置換が効いていないことに気づきにくい。
    // 出力の実バイトで確かめる。
    const escaped = escapeIcsText('9:00;10:00');
    expect(escaped).toBe('9:00\\;10:00');
    expect(escaped.includes('\\')).toBe(true);
    expect([...escaped].filter((c) => c === '\\')).toHaveLength(1);
  });

  it('エスケープした値が iCalendar の行として壊れない', () => {
    // DESCRIPTION 内の生のセミコロンはパラメータ区切りと誤読される。
    const line = `DESCRIPTION:${escapeIcsText('締切;厳守')}`;
    expect(line).toBe('DESCRIPTION:締切\\;厳守');
    // 生のセミコロン（直前がバックスラッシュでないもの）が残っていない。
    expect(line.slice('DESCRIPTION:'.length)).not.toMatch(/(?<!\\);/);
  });
});

describe('foldIcsLine', () => {
  it('75オクテット以下は折らない', () => {
    const line = 'SUMMARY:short';
    expect(foldIcsLine(line)).toBe(line);
  });

  it('日本語は文字数ではなくバイト数で折る', () => {
    // 「あ」は UTF-8 で3オクテット。40文字＝120オクテットなので折られる。
    const folded = foldIcsLine(`SUMMARY:${'あ'.repeat(40)}`);
    expect(folded).toContain('\r\n ');
    const encoder = new TextEncoder();
    for (const part of folded.split('\r\n')) {
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
    }
  });

  it('マルチバイト文字の途中では折らない', () => {
    const folded = foldIcsLine(`DESCRIPTION:${'漢'.repeat(60)}`);
    // 分割して結合し直すと元に戻る（＝壊れた文字が無い）。
    expect(folded.split('\r\n ').join('')).toBe(`DESCRIPTION:${'漢'.repeat(60)}`);
  });
});

describe('buildIcs', () => {
  const occurrences = occurrencesOf([salary], '2026-10-01', '2026-10-31');
  const ics = buildIcs(occurrences, rulesMap([salary]), OPTIONS, NOW);

  it('カレンダーの外枠を持つ', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('X-WR-CALNAME:営業日スケジュール');
  });

  it('改行はすべて CRLF', () => {
    expect(ics.split('\r\n').join('')).not.toContain('\n');
  });

  it('終日予定として出し、DTEND は翌日にする', () => {
    // 2026-10-25(日) → 10-23(金)
    expect(ics).toContain('DTSTART;VALUE=DATE:20261023');
    expect(ics).toContain('DTEND;VALUE=DATE:20261024');
  });

  it('補正の由来を説明に残す', () => {
    expect(unfold(ics)).toContain('本来は 2026-10-25（休業日）。前営業日へ前倒し。');
  });

  it('事前通知も予定にする', () => {
    expect(unfold(ics)).toContain('SUMMARY:給与振込: 振込データ作成');
    expect(unfold(ics)).toContain('の予定に対する事前準備');
  });

  it('事前通知を除ける', () => {
    const withoutNotices = buildIcs(
      occurrences,
      rulesMap([salary]),
      { ...OPTIONS, includeNotices: false },
      NOW,
    );
    expect(unfold(withoutNotices)).not.toContain('振込データ作成');
    expect(withoutNotices.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it('UID は内容から決まり、作り直しても変わらない', () => {
    const again = buildIcs(occurrences, rulesMap([salary]), OPTIONS, new Date('2027-01-01T00:00:00Z'));
    const uids = (text: string): string[] => text.match(/^UID:.*$/gm) ?? [];
    expect(uids(ics)).toEqual(uids(again));
    expect(uids(ics)[0]).toContain('@business-days-schedule');
  });

  it('UID は補正前の基準日から作る（祝日データが変わっても同じ予定でいられる）', () => {
    // 確定日 10-23 は補正の結果。UID には基準日 10-25 が入る。
    const uids = ics.match(/^UID:.*$/gm) ?? [];
    expect(uids.some((uid) => uid.includes('2026-10-25'))).toBe(true);
    expect(uids.some((uid) => uid.includes('salary-main-2026-10-23'))).toBe(false);
  });

  it('UID が重複しない', () => {
    const many = occurrencesOf([salary], '2026-01-01', '2026-12-31');
    const text = buildIcs(many, rulesMap([salary]), OPTIONS, NOW);
    const uids = text.match(/^UID:.*$/gm) ?? [];
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('DTSTAMP は書き出した時刻', () => {
    expect(ics).toContain('DTSTAMP:20260905T012345Z');
  });
});

describe('buildCsv', () => {
  const occurrences = occurrencesOf([salary], '2026-10-01', '2026-10-31');
  const csv = buildCsv(occurrences, rulesMap([salary]), OPTIONS);

  it('Google カレンダーの列見出しを持つ', () => {
    expect(csv.split('\r\n')[0]).toBe(
      '﻿Subject,Start Date,Start Time,End Date,End Time,All Day Event,Description,Location,Private',
    );
  });

  it('日付は M/D/YYYY', () => {
    expect(toCsvDate('2026-10-23')).toBe('10/23/2026');
    expect(toCsvDate('2026-01-05')).toBe('1/5/2026');
    expect(csv).toContain(',10/23/2026,');
  });

  it('終日予定にする', () => {
    expect(csv).toContain(',True,');
  });

  it('カンマや引用符を含む値を退避する', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('plain')).toBe('plain');
    // 説明文に読点や区切りが入っても列がずれない。
    const lines = csv.split('\r\n').filter((line) => line !== '');
    for (const line of lines) {
      expect(line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)).toHaveLength(9);
    }
  });

  it('説明の改行を1行にたたむ', () => {
    // 生の LF（CRLF でない改行）が無いこと。
    expect(csv).not.toMatch(/(?<!\r)\n/);
    expect(csv).toContain('前営業日へ前倒し。 / 毎月25日');
  });
});

describe('describeOccurrence', () => {
  it('補正が無ければ由来を書かない', () => {
    const plain = makeRule({
      id: 'plain',
      title: '定例',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
    });
    const [occurrence] = occurrencesOf([plain], '2026-09-01', '2026-09-30');
    expect(occurrence).toBeDefined();
    expect(describeOccurrence(occurrence as Occurrence, plain)).toBe('毎月10日 / 補正なし');
  });
});

describe('exportCalendarFileName', () => {
  it('期間と形式が分かる名前にする', () => {
    expect(exportCalendarFileName('2026-09-05', '2027-09-04', 'ics')).toBe(
      'business-days-20260905-20270904.ics',
    );
    expect(exportCalendarFileName('2026-09-05', '2026-12-31', 'csv')).toBe(
      'business-days-20260905-20261231.csv',
    );
  });
});
