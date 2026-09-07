/**
 * データ生成・検証スクリプトのパーサ（docs/SPEC.md §3）。
 * ネットワークには触れず、パース部分だけを対象にする。
 */

import { describe, expect, it } from 'vitest';
import {
  YEARS_AHEAD,
  YEARS_BACK,
  buildHolidayData,
  parseHolidaysYml,
} from '../scripts/build-holidays';

describe('parseHolidaysYml', () => {
  it('holidays.yml の1行1レコードを読む', () => {
    const yml = [
      '---',
      '# コメント行',
      '2026-01-01: 元日',
      '2026-05-06: こどもの日 振替休日',
      '2026-09-22: 休日',
      '2019-05-01: "休日（祝日扱い）"',
      '',
    ].join('\n');
    expect(parseHolidaysYml(yml)).toEqual({
      '2026-01-01': '元日',
      '2026-05-06': 'こどもの日 振替休日',
      '2026-09-22': '休日',
      '2019-05-01': '休日（祝日扱い）',
    });
  });

  it('CRLF と行末の空白を許容する', () => {
    expect(parseHolidaysYml('2026-01-01: 元日  \r\n2026-01-12: 成人の日\r\n')).toEqual({
      '2026-01-01': '元日',
      '2026-01-12': '成人の日',
    });
  });

  it('日付形式でない行は無視する', () => {
    expect(parseHolidaysYml('meta: something\n2026-01-01: 元日')).toEqual({ '2026-01-01': '元日' });
  });
});

describe('buildHolidayData', () => {
  const now = new Date('2026-09-04T00:00:00Z');

  it('日付昇順に並べ、生成年を基準に収録範囲を決める', () => {
    const data = buildHolidayData(
      { '2027-01-01': '元日', '2026-01-01': '元日', '2026-05-06': 'こどもの日 振替休日' },
      'abc123',
      now,
    );
    expect(Object.keys(data.holidays)).toEqual(['2026-01-01', '2026-05-06', '2027-01-01']);
    expect(data.meta.range).toEqual({
      from: `${2026 - YEARS_BACK}-01-01`,
      to: `${2026 + YEARS_AHEAD}-12-31`,
    });
    expect(data.meta.count).toBe(3);
    expect(data.meta.sourceSha).toBe('abc123');
  });

  it('収録範囲の外にある年は同梱しない', () => {
    // アプリ本体に埋め込むので、実務で使わない年まで持つと無駄に重くなる。
    const data = buildHolidayData(
      { '1970-01-01': '元日', '2026-01-01': '元日', '2050-11-23': '勤労感謝の日' },
      null,
      now,
    );
    expect(Object.keys(data.holidays)).toEqual(['2026-01-01']);
    expect(data.meta.count).toBe(1);
  });

  it('範囲内に1件も無ければ例外にする（既存データを空で上書きしない）', () => {
    expect(() => buildHolidayData({}, null, now)).toThrow();
    expect(() => buildHolidayData({ '1970-01-01': '元日' }, null, now)).toThrow();
  });
});
