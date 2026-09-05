/**
 * 第三者レビューで見つかった不具合の回帰テスト。
 *
 * いずれも「型は正しいのに実行時に壊れる」種類で、単体テストの隙間から落ちていた。
 * 同じ穴を二度開けないよう、再現条件をそのまま固定する。
 */

import { describe, expect, it } from 'vitest';
import { buildIcs, escapeIcsText } from '../src/core/exportCalendar';
import { outOfRangeMessage } from '../src/core/holidays';
import { expandRules, noticeSpanDays } from '../src/core/schedule';
import { createMemoryStore, importState, loadState, createDefaultState } from '../src/core/storage';
import { LIMITS, validateCalendar, validateRule } from '../src/core/validate';
import type { Notice, Rule } from '../src/types';
import { holidays, makeRule, scheduleContext } from './helpers';

// ---------------------------------------------------------------------------
// P0-1: 長い事前通知が表示・出力されない
// ---------------------------------------------------------------------------

describe('長い事前通知（展開範囲が固定だと欠落していた）', () => {
  const withNotice = (notice: Notice): Rule =>
    makeRule({
      id: 'long',
      title: '長期準備',
      recurrence: { type: 'monthlyByDay', interval: 1, months: [11], days: [30], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
      notices: [notice],
    });

  it('60営業日前の通知が、通知日を含む月の表示で出る', () => {
    const rule = withNotice({ offset: -60, unit: 'business', label: '準備開始' });
    // 本体は 2026-11-30。60営業日前は 2026-08-28（別途算出）。
    const august = expandRules(
      [rule],
      { start: '2026-08-01', end: '2026-08-31' },
      scheduleContext,
    ).occurrences;
    expect(august.map((o) => [o.kind, o.date])).toEqual([['notice', '2026-08-28']]);
  });

  it('60暦日前でも同じ', () => {
    const rule = withNotice({ offset: -60, unit: 'calendar', label: '準備開始' });
    // 2026-11-30 の60暦日前 = 2026-10-01
    const october = expandRules(
      [rule],
      { start: '2026-10-01', end: '2026-10-31' },
      scheduleContext,
    ).occurrences;
    expect(october.map((o) => o.date)).toContain('2026-10-01');
  });

  it('年をまたぐ通知も出る', () => {
    const rule = makeRule({
      id: 'crossYear',
      title: '年度末準備',
      recurrence: { type: 'monthlyByDay', interval: 1, months: [3], days: [1], overflow: 'clamp' },
      adjust: { mode: 'next', keepInMonth: false },
      notices: [{ offset: -90, unit: 'calendar', label: '準備開始' }],
    });
    // 2027-03-01 の90暦日前 = 2026-12-01
    const december = expandRules(
      [rule],
      { start: '2026-12-01', end: '2026-12-31' },
      scheduleContext,
    ).occurrences;
    expect(december.map((o) => o.date)).toContain('2026-12-01');
  });

  it('通知を持たないルールでは展開範囲を広げない', () => {
    expect(noticeSpanDays(makeRule({ notices: [] }))).toBe(0);
    expect(
      noticeSpanDays(makeRule({ notices: [{ offset: -10, unit: 'calendar', label: '' }] })),
    ).toBe(10);
    // 営業日換算は安全側に広く取る。
    expect(
      noticeSpanDays(makeRule({ notices: [{ offset: -10, unit: 'business', label: '' }] })),
    ).toBeGreaterThan(10);
  });

  it('通知の範囲を広げても本体の件数は変わらない', () => {
    const plain = makeRule({
      id: 'plain',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
    });
    const withLongNotice = makeRule({
      ...plain,
      id: 'noticed',
      notices: [{ offset: -60, unit: 'business', label: 'x' }],
    });
    const range = { start: '2026-05-01', end: '2026-05-31' };
    const a = expandRules([plain], range, scheduleContext).occurrences.filter((o) => o.kind === 'main');
    const b = expandRules([withLongNotice], range, scheduleContext).occurrences.filter(
      (o) => o.kind === 'main',
    );
    expect(a.map((o) => o.date)).toEqual(b.map((o) => o.date));
  });
});

// ---------------------------------------------------------------------------
// P0-2: サンプル再追加で編集内容が無警告に上書きされる
// ---------------------------------------------------------------------------

describe('サンプルの取り込みで編集内容を守る', () => {
  const pack = {
    schemaVersion: 1,
    exportedAt: '2026-01-01T00:00:00.000Z',
    calendars: [],
    rules: [makeRule({ id: 'sample-a', title: '元の名前' })],
  };

  it('add は編集後の名前を上書きしない', () => {
    const current = { ...createDefaultState(), rules: [makeRule({ id: 'sample-a', title: '自分で変えた名前' })] };
    const result = importState(JSON.parse(JSON.stringify(pack)), current, 'add');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.rules[0]?.title).toBe('自分で変えた名前');
    expect(result.untouched.rules).toBe(1);
    expect(result.applied.rules).toBe(0);
  });

  it('merge は明示的に元へ戻す', () => {
    const current = { ...createDefaultState(), rules: [makeRule({ id: 'sample-a', title: '自分で変えた名前' })] };
    const result = importState(JSON.parse(JSON.stringify(pack)), current, 'merge');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.rules[0]?.title).toBe('元の名前');
    expect(result.applied.rules).toBe(1);
  });

  it('追加済みの束は設定として残る（再読込しても分かる）', () => {
    const store = createMemoryStore();
    const state = createDefaultState();
    state.prefs.addedSamplePacks = ['tax', 'meetings'];
    store.setItem('bds.v1.prefs', JSON.stringify(state.prefs));
    expect(loadState(store).prefs.addedSamplePacks).toEqual(['tax', 'meetings']);
  });
});

// ---------------------------------------------------------------------------
// P0-3: 実行時の入力検証
// ---------------------------------------------------------------------------

describe('壊れた入力でも例外にしない', () => {
  const garbage: unknown[] = [
    {},
    null,
    42,
    'string',
    [],
    { title: 123 },
    { title: 'x', recurrence: null },
    { title: 'x', recurrence: { type: 'unknown' } },
    { title: 'x', recurrence: { type: 'weekly', interval: 1, weekdays: 'not-array' } },
    { title: 'x', notices: 'not-array' },
    { title: 'x', skipDates: [123] },
    { title: 'x', period: 'nope' },
    { title: 'x', adjust: { mode: 'evil', keepInMonth: 'yes' } },
  ];

  it.each(garbage.map((value, index) => [index, value] as const))(
    'validateRule は例外を投げない (%i)',
    (_index, value) => {
      expect(() => validateRule(value as Rule)).not.toThrow();
      expect(validateRule(value as Rule).length).toBeGreaterThan(0);
    },
  );

  it('validateCalendar も例外を投げない', () => {
    for (const value of garbage) {
      expect(() => validateCalendar(value as never)).not.toThrow();
    }
  });

  it('巨大な事前通知は弾く（数えるだけで固まるため）', () => {
    const rule = makeRule({
      title: 'x',
      notices: [{ offset: -1_000_000_000, unit: 'business', label: 'y' }],
    });
    const issues = validateRule(rule);
    expect(issues.map((i) => i.path)).toContain('notices[0].offset');
    expect(LIMITS.noticeOffset).toBeLessThanOrEqual(365);
  });

  it('上限内の事前通知は通す', () => {
    expect(
      validateRule(makeRule({ title: 'x', notices: [{ offset: -365, unit: 'business', label: 'y' }] })),
    ).toEqual([]);
  });

  it('件数・文字数の上限を持つ', () => {
    const many = Array.from({ length: LIMITS.notices + 1 }, () => ({
      offset: -1,
      unit: 'business' as const,
      label: 'x',
    }));
    expect(validateRule(makeRule({ title: 'x', notices: many })).map((i) => i.path)).toContain('notices');
    expect(
      validateRule(makeRule({ title: 'あ'.repeat(LIMITS.titleLength + 1) })).map((i) => i.path),
    ).toContain('title');
  });

  it('壊れた localStorage でも起動できる', () => {
    const store = createMemoryStore();
    store.setItem('bds.v1.rules', JSON.stringify([{}, { title: null }]));
    store.setItem('bds.v1.calendars', JSON.stringify([{ id: 1 }]));
    expect(() => loadState(store)).not.toThrow();
    const loaded = loadState(store);
    expect(loaded.rules).toEqual([]);
    // カレンダーが全滅したら既定へ戻す。
    expect(loaded.calendars.length).toBeGreaterThan(0);
    expect(loaded.droppedRules).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// P1-4: iCalendar のエスケープと UID
// ---------------------------------------------------------------------------

describe('iCalendar の安全性', () => {
  // 期待値は String.raw で書く。'\;' は JavaScript では ';' になってしまい、
  // 「エスケープしていないコード」と「エスケープを期待しないテスト」が
  // 揃って通ってしまう。実際にそれで見逃していた。
  it('セミコロンをエスケープする', () => {
    expect(escapeIcsText('a;b')).toBe(String.raw`a\;b`);
    expect(escapeIcsText('a,b')).toBe(String.raw`a\,b`);
  });

  it('書き出した本文に生のセミコロンが残らない', () => {
    const rule = makeRule({
      id: 'semi',
      title: '締切;厳守',
      note: '担当;経理',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
    });
    const { occurrences } = expandRules(
      [rule],
      { start: '2026-09-01', end: '2026-09-30' },
      scheduleContext,
    );
    const ics = buildIcs(occurrences, new Map([[rule.id, rule]]), {
      includeNotices: false,
      calendarName: 'x',
    });
    const unfolded = ics.split('\r\n ').join('');
    for (const line of unfolded.split('\r\n')) {
      if (!line.startsWith('SUMMARY:') && !line.startsWith('DESCRIPTION:')) continue;
      const value = line.slice(line.indexOf(':') + 1);
      expect(value, line).not.toMatch(/(?<!\\);/);
    }
    expect(unfolded).toContain(String.raw`SUMMARY:締切\;厳守`);
  });
});

// ---------------------------------------------------------------------------
// P2-8: 収録範囲の警告
// ---------------------------------------------------------------------------

describe('祝日データの収録範囲', () => {
  it('範囲内なら警告しない', () => {
    expect(outOfRangeMessage(holidays, '2026-01-01', '2026-12-31')).toBeNull();
  });

  it('範囲を外れたら期間を示して警告する', () => {
    // テスト用スナップショットは 2023-2027。
    const message = outOfRangeMessage(holidays, '2026-01-01', '2030-12-31');
    expect(message).not.toBeNull();
    expect(message).toContain('2030-12-31');
    expect(message).toContain('2027-12-31');
    expect(outOfRangeMessage(holidays, '2020-01-01', '2026-12-31')).not.toBeNull();
  });
});
