import { describe, expect, it } from 'vitest';
import {
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
    expect(loadState(store)).toEqual(state);
  });

  it('壊れた値は既定値に倒す', () => {
    const store = createMemoryStore();
    store.setItem('bds.v1.rules', '{ this is not json');
    expect(loadState(store).rules).toEqual([]);
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
