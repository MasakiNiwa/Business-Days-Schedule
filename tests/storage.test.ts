import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  buildExportFile,
  clearState,
  createDefaultState,
  createMemoryStore,
  createRule,
  exportFileName,
  importState,
  loadState,
  saveState,
  SCHEMA_VERSION,
} from '../src/core/storage';
import { makeRule } from './helpers';

describe('load / save', () => {
  it('未保存なら既定値を返す', () => {
    const state = loadState(createMemoryStore());
    expect(state.rules).toEqual([]);
    expect(state.calendars.map((c) => c.id)).toEqual(['company', 'bank']);
    expect(state.prefs.listDays).toBe(90);
    expect(state.prefs.theme).toBe('auto');
  });

  it('保存して読み戻せる', () => {
    const store = createMemoryStore();
    const state = { ...createDefaultState(), rules: [makeRule({ title: '給与振込' })] };
    saveState(store, state);
    const loaded = loadState(store);
    expect(loaded.rules).toEqual(state.rules);
    expect(loaded.calendars).toEqual(state.calendars);
    expect(loaded.prefs).toEqual(state.prefs);
    expect(loaded.droppedRules).toBe(0);
  });

  it('壊れた値は既定値に倒す', () => {
    const store = createMemoryStore();
    store.setItem('bds.v1.rules', '{ this is not json');
    expect(loadState(store).rules).toEqual([]);
  });

  it('壊れたデータは1件だけ捨て、件数を返す（起動不能にしない）', () => {
    const store = createMemoryStore();
    // 型が全く合わない値でも例外にせず、健全な分だけ読み込む。
    store.setItem('bds.v1.rules', JSON.stringify([{}, null, 42, makeRule({ title: '正常' })]));
    const loaded = loadState(store);
    expect(loaded.rules.map((rule) => rule.title)).toEqual(['正常']);
    expect(loaded.droppedRules).toBe(3);
  });

  it('壊れた表示設定は既定へ戻す', () => {
    const store = createMemoryStore();
    store.setItem('bds.v1.prefs', JSON.stringify({ defaultView: 'evil', listDays: -5, theme: 'x' }));
    const loaded = loadState(store);
    expect(loaded.prefs).toEqual(DEFAULT_PREFERENCES);
  });

  it('検証に通らないルールは読み込まない', () => {
    const store = createMemoryStore();
    saveState(store, {
      ...createDefaultState(),
      rules: [makeRule({ title: '正常' }), makeRule({ id: 'bad', title: '' })],
    });
    expect(loadState(store).rules.map((r) => r.title)).toEqual(['正常']);
  });

  it('配色モードを保存して読み戻せる', () => {
    const store = createMemoryStore();
    const state = createDefaultState();
    state.prefs.theme = 'dark';
    saveState(store, state);
    expect(loadState(store).prefs.theme).toBe('dark');
  });

  it('clearState で消える', () => {
    const store = createMemoryStore();
    saveState(store, { ...createDefaultState(), rules: [makeRule({ title: 'x' })] });
    clearState(store);
    expect(loadState(store).rules).toEqual([]);
  });
});

describe('エクスポート / インポート', () => {
  const state = {
    ...createDefaultState(),
    rules: [makeRule({ id: 'a', title: '給与振込' })],
  };

  it('往復して同一になる', () => {
    const file = buildExportFile(state);
    const parsed: unknown = JSON.parse(JSON.stringify(file));
    const result = importState(parsed, createDefaultState(), 'replace');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.rules).toEqual(state.rules);
    expect(result.state.calendars).toEqual(state.calendars);
  });

  it('ファイル名が日付入りになる', () => {
    // 日本時間の日付で命名する（UTC 深夜でも日付が繰り上がらない）。
    expect(exportFileName(new Date('2026-09-04T00:00:00Z'))).toBe(
      'business-days-schedule-20260904.json',
    );
    expect(exportFileName(new Date('2026-09-03T16:00:00Z'))).toBe(
      'business-days-schedule-20260904.json',
    );
  });

  it('形式が不正なファイルは拒否する', () => {
    expect(importState(null, state, 'replace')).toEqual({
      ok: false,
      errors: ['ファイルの形式が不正です'],
    });
    expect(importState({ rules: [], calendars: [] }, state, 'replace').ok).toBe(false);
    expect(importState({ schemaVersion: 1, rules: {}, calendars: [] }, state, 'replace').ok).toBe(false);
  });

  it('未来の schemaVersion は拒否する', () => {
    const result = importState(
      { schemaVersion: SCHEMA_VERSION + 1, rules: [], calendars: [] },
      state,
      'replace',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain('新しい形式');
  });

  it('検証に通らないルールは取り込まず件数を返す', () => {
    const file = {
      ...buildExportFile(state),
      rules: [makeRule({ id: 'a', title: '正常' }), makeRule({ id: 'b', title: '' })],
    };
    const result = importState(JSON.parse(JSON.stringify(file)), createDefaultState(), 'replace');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.rules).toHaveLength(1);
    expect(result.skipped.rules).toBe(1);
  });

  it('replace はカレンダーが空なら既定値へ戻す', () => {
    const result = importState(
      { schemaVersion: 1, exportedAt: '', rules: [], calendars: [], prefs: {} },
      state,
      'replace',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.calendars.map((c) => c.id)).toEqual(['company', 'bank']);
  });

  it('add は既存の ID を触らない（編集内容を守る）', () => {
    const current = { ...createDefaultState(), rules: [makeRule({ id: 'a', title: '編集した名前' })] };
    const file = {
      ...buildExportFile(state),
      rules: [makeRule({ id: 'a', title: '元の名前' }), makeRule({ id: 'c', title: '追加' })],
    };
    const result = importState(JSON.parse(JSON.stringify(file)), current, 'add');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.rules.map((r) => [r.id, r.title])).toEqual([
      ['a', '編集した名前'],
      ['c', '追加'],
    ]);
    expect(result.applied.rules).toBe(1);
    expect(result.untouched.rules).toBe(1);
  });

  it('merge は ID 衝突時に取り込み側を採用する', () => {
    const current = { ...createDefaultState(), rules: [makeRule({ id: 'a', title: '既存' })] };
    const file = {
      ...buildExportFile(state),
      rules: [makeRule({ id: 'a', title: '取り込み' }), makeRule({ id: 'c', title: '追加' })],
    };
    const result = importState(JSON.parse(JSON.stringify(file)), current, 'merge');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.rules.map((r) => [r.id, r.title])).toEqual([
      ['a', '取り込み'],
      ['c', '追加'],
    ]);
  });
});

describe('createRule', () => {
  it('既定値を持つ新規ルールを作る', () => {
    const rule = createRule({ title: 'テスト' });
    expect(rule.title).toBe('テスト');
    expect(rule.enabled).toBe(true);
    expect(rule.calendarId).toBe('company');
    expect(rule.id).not.toBe('');
  });

  it('ID が重複しない', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createRule().id));
    expect(ids.size).toBe(100);
  });
});
