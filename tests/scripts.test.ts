/**
 * データ生成・検証スクリプトのパーサ（docs/SPEC.md §3）。
 * ネットワークには触れず、パース部分だけを対象にする。
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { HolidayData } from '../src/types';
import {
  authHeaderFor,
  buildHolidayData,
  chooseFallback,
  newerOf,
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

describe('newerOf', () => {
  const at = (fetchedAt: string): HolidayData => ({
    meta: {
      source: 'holiday-jp/holiday_jp',
      sourceUrl: '',
      sourceSha: null,
      fetchedAt,
      range: { from: '2026-01-01', to: '2026-12-31' },
      count: 0,
    },
    holidays: {},
  });

  it('取得時刻の新しいほうを選ぶ', () => {
    // リポジトリの版だけに落とすと、週次で更新したぶんを巻き戻してしまう。
    const older = at('2026-01-01T00:00:00.000Z');
    const newer = at('2026-09-08T00:00:00.000Z');
    expect(newerOf(older, newer)).toBe(newer);
    expect(newerOf(newer, older)).toBe(newer);
  });

  it('片方しか読めなければ、そちらを使う', () => {
    const only = at('2026-01-01T00:00:00.000Z');
    expect(newerOf(only, null)).toBe(only);
    expect(newerOf(null, only)).toBe(only);
  });

  it('どちらも読めなければ null', () => {
    // 初回公開などで公開先が空のときは、リポジトリの版すら無ければ止めるほかない。
    expect(newerOf(null, null)).toBeNull();
  });

  it('同じ時刻なら手元の版を保つ（不要な書き換えをしない）', () => {
    const a = at('2026-09-08T00:00:00.000Z');
    const b = at('2026-09-08T00:00:00.000Z');
    expect(newerOf(a, b)).toBe(a);
  });
});

describe('chooseFallback', () => {
  const at = (fetchedAt: string): HolidayData => ({
    meta: {
      source: 'x',
      sourceUrl: 'x',
      sourceSha: null,
      fetchedAt,
      range: { from: '2026-01-01', to: '2026-12-31' },
      count: 1,
    },
    holidays: { '2026-01-01': '元日' },
  });

  it('公開中の版を確認できないなら公開しない', () => {
    // リポジトリの版が古ければ、そのまま公開中のデータを巻き戻してしまう。
    // 止めれば、いま公開されているものがそのまま残る。
    const result = chooseFallback(at('2026-01-01T00:00:00Z'), {
      status: 'unknown',
      reason: 'fetch failed',
    });
    expect(result.action).toBe('stop');
  });

  it('リポジトリの版しか無くても、確認できないなら止める', () => {
    expect(chooseFallback(at('2099-01-01T00:00:00Z'), { status: 'unknown', reason: 'x' }).action).toBe(
      'stop',
    );
  });

  it('まだ何も公開していない（404）なら、リポジトリの版で続ける', () => {
    // 巻き戻す先が無いので、代替は安全。
    const result = chooseFallback(at('2026-01-01T00:00:00Z'), { status: 'absent' });
    expect(result).toMatchObject({ action: 'use', from: 'local' });
  });

  it('公開中の版が新しければそちらを使う', () => {
    const local = at('2026-01-01T00:00:00Z');
    const published = at('2026-06-01T00:00:00Z');
    expect(chooseFallback(local, { status: 'ok', data: published })).toMatchObject({
      action: 'use',
      from: 'published',
      data: published,
    });
  });

  it('リポジトリの版が新しければそちらを使う', () => {
    const local = at('2026-06-01T00:00:00Z');
    expect(chooseFallback(local, { status: 'ok', data: at('2026-01-01T00:00:00Z') })).toMatchObject({
      action: 'use',
      from: 'local',
    });
  });

  it('どちらも無ければ止める', () => {
    expect(chooseFallback(null, { status: 'absent' }).action).toBe('stop');
  });
});
