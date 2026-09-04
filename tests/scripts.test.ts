/**
 * データ生成・検証スクリプトのパーサ（docs/SPEC.md §3）。
 * ネットワークには触れず、パース部分だけを対象にする。
 */

import { describe, expect, it } from 'vitest';
import { buildHolidayData, parseHolidaysYml } from '../scripts/build-holidays';
import { diffHolidays, parseCaoCsv } from '../scripts/verify-cao';

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

  it('日付昇順に並べ、収録範囲を暦年で丸める', () => {
    const data = buildHolidayData(
      { '2027-01-01': '元日', '2026-01-01': '元日', '2026-05-06': 'こどもの日 振替休日' },
      'abc123',
      true,
      now,
    );
    expect(Object.keys(data.holidays)).toEqual(['2026-01-01', '2026-05-06', '2027-01-01']);
    expect(data.meta.range).toEqual({ from: '2026-01-01', to: '2027-12-31' });
    expect(data.meta.count).toBe(3);
    expect(data.meta.sourceSha).toBe('abc123');
    expect(data.meta.verifiedAgainstCao).toBe(true);
  });

  it('1件も無ければ例外にする（既存データを空で上書きしない）', () => {
    expect(() => buildHolidayData({}, null, null, now)).toThrow();
  });
});

describe('parseCaoCsv', () => {
  it('内閣府 CSV のヘッダーを読み飛ばして日付を正規化する', () => {
    const csv = [
      '国民の祝日・休日月日,国民の祝日・休日名称',
      '2026/1/1,元日',
      '2026/1/12,成人の日',
      '2026/5/6,休日',
      '',
    ].join('\r\n');
    expect(parseCaoCsv(csv)).toEqual({
      '2026-01-01': '元日',
      '2026-01-12': '成人の日',
      '2026-05-06': '休日',
    });
  });

  it('ハイフン区切りでも読める', () => {
    expect(parseCaoCsv('2026-01-01,元日')).toEqual({ '2026-01-01': '元日' });
  });
});

describe('diffHolidays', () => {
  const ours = { '2026-01-01': '元日', '2026-05-06': 'こどもの日 振替休日', '2030-01-01': '元日' };

  it('日付の有無だけを比較する（名称の表記ゆれは無視）', () => {
    const cao = { '2026-01-01': '元日', '2026-05-06': '休日' };
    expect(diffHolidays(ours, cao, 2026, 1)).toEqual([]);
  });

  it('欠落と余剰を検出する', () => {
    const cao = { '2026-01-01': '元日', '2026-02-11': '建国記念の日' };
    expect(diffHolidays(ours, cao, 2026, 1)).toEqual([
      { date: '2026-02-11', ours: null, cao: '建国記念の日' },
      { date: '2026-05-06', ours: 'こどもの日 振替休日', cao: null },
    ]);
  });

  it('対象年の外は比較しない', () => {
    expect(diffHolidays(ours, {}, 2026, 1).map((d) => d.date)).not.toContain('2030-01-01');
  });
});
