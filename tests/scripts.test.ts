/**
 * データ生成・検証スクリプトのパーサ（docs/SPEC.md §3）。
 * ネットワークには触れず、パース部分だけを対象にする。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { authHeaderFor, buildHolidayData, parseHolidaysYml } from '../scripts/build-holidays';

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
      now,
    );
    expect(Object.keys(data.holidays)).toEqual(['2026-01-01', '2026-05-06', '2027-01-01']);
    expect(data.meta.range).toEqual({ from: '2026-01-01', to: '2027-12-31' });
    expect(data.meta.count).toBe(3);
    expect(data.meta.sourceSha).toBe('abc123');
  });

  it('出典の全期間をそのまま残す（年を絞らない）', () => {
    // 過去へ遡って確かめたい場面があるため、古い年も落とさない。
    const data = buildHolidayData(
      { '1970-01-01': '元日', '2026-01-01': '元日', '2050-11-23': '勤労感謝の日' },
      null,
      now,
    );
    expect(Object.keys(data.holidays)).toEqual(['1970-01-01', '2026-01-01', '2050-11-23']);
    expect(data.meta.range).toEqual({ from: '1970-01-01', to: '2050-12-31' });
    expect(data.meta.count).toBe(3);
  });

  it('1件も無ければ例外にする（既存データを空で上書きしない）', () => {
    expect(() => buildHolidayData({}, null, now)).toThrow();
  });
});

describe('authHeaderFor', () => {
  const original = process.env['GITHUB_TOKEN'];
  afterEach(() => {
    if (original === undefined) delete process.env['GITHUB_TOKEN'];
    else process.env['GITHUB_TOKEN'] = original;
  });

  it('GitHub API にはトークンを付ける', () => {
    // 認証なしは IP あたり60回/時で、共用ランナーではすぐ 403 になる。
    process.env['GITHUB_TOKEN'] = 'abc';
    expect(authHeaderFor('https://api.github.com/repos/x/y/commits')).toEqual({
      authorization: 'Bearer abc',
    });
  });

  it('GitHub API 以外には付けない', () => {
    // 資格情報を関係のない相手へ送らない。
    process.env['GITHUB_TOKEN'] = 'abc';
    expect(authHeaderFor('https://raw.githubusercontent.com/x/y/holidays.yml')).toEqual({});
  });

  it('トークンが無ければ付けない（手元でもそのまま動く）', () => {
    delete process.env['GITHUB_TOKEN'];
    expect(authHeaderFor('https://api.github.com/repos/x/y/commits')).toEqual({});
    process.env['GITHUB_TOKEN'] = '';
    expect(authHeaderFor('https://api.github.com/repos/x/y/commits')).toEqual({});
  });
});
