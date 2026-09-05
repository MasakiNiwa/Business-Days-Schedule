/**
 * @vitest-environment node
 *
 * 同梱サンプル（docs/SPEC.md §9.3）が全束そのまま取り込めることを保証する。
 * サンプルが壊れると導入の入口が死ぬため、CI で常に検証する。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBusinessDayCalendar } from '../src/core/businessDay';
import { parseSampleIndex } from '../src/core/samples';
import { expandRules } from '../src/core/schedule';
import type { ScheduleContext } from '../src/core/schedule';
import { createDefaultState, importState } from '../src/core/storage';
import { holidays } from './helpers';

const DIR = resolve(import.meta.dirname, '../public/data/samples');
const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(DIR, name), 'utf-8'));

const packs = parseSampleIndex(readJson('index.json'));

const context = (state: ReturnType<typeof createDefaultState>): ScheduleContext => ({
  calendars: new Map(
    state.calendars.map((calendar) => [calendar.id, createBusinessDayCalendar(calendar, holidays)]),
  ),
  fallbackCalendarId: 'company',
});

describe('サンプル一覧', () => {
  it('束が並んでいる', () => {
    expect(packs.length).toBeGreaterThanOrEqual(5);
    for (const pack of packs) {
      expect(pack.name, pack.id).not.toBe('');
      expect(pack.description, pack.id).not.toBe('');
      expect(pack.count, pack.id).toBeGreaterThan(0);
    }
  });

  it('id が重複しない', () => {
    expect(new Set(packs.map((pack) => pack.id)).size).toBe(packs.length);
  });

  it('一覧にある束のファイルがすべて存在し、余分なファイルも無い', () => {
    const listed = new Set(packs.map((pack) => pack.file));
    const onDisk = new Set(
      readdirSync(DIR).filter((name) => name.endsWith('.json') && name !== 'index.json'),
    );
    expect([...onDisk].sort()).toEqual([...listed].sort());
  });

  it('形式が不正な一覧は拒否する', () => {
    expect(() => parseSampleIndex(null)).toThrow();
    expect(() => parseSampleIndex({})).toThrow();
    expect(() => parseSampleIndex({ packs: [{ id: 'x' }] })).toThrow();
  });
});

describe.each(packs.map((pack) => [pack.name, pack] as const))('サンプル: %s', (_name, pack) => {
  const raw = readJson(pack.file);

  it('検証を通過し、1件も欠落しない', () => {
    const result = importState(raw, createDefaultState(), 'merge');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toEqual({ rules: 0, calendars: 0 });
    expect(result.state.rules).toHaveLength(pack.count);
  });

  it('カレンダー設定を持たない（追加時に利用者の設定を上書きしないため）', () => {
    expect((raw as { calendars: unknown[] }).calendars).toEqual([]);
    const current = createDefaultState();
    const result = importState(raw, current, 'merge');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.calendars).toEqual(current.calendars);
  });

  it('1年分を警告なしで展開でき、予定が出る', () => {
    const state = createDefaultState();
    const result = importState(raw, state, 'merge');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { occurrences, warnings } = expandRules(
      result.state.rules,
      { start: '2026-01-01', end: '2026-12-31' },
      context(result.state),
    );
    expect(warnings).toEqual([]);
    expect(occurrences.length).toBeGreaterThan(0);
    for (const occurrence of occurrences) {
      expect(occurrence.date >= '2026-01-01' && occurrence.date <= '2026-12-31').toBe(true);
    }
  });

  it('ルール ID が束をまたいで衝突しない', () => {
    const ids = (raw as { rules: { id: string }[] }).rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('既存のルールを消さずに足せる', () => {
    const base = importState(readJson('business-basics.json'), createDefaultState(), 'merge');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const added = importState(raw, base.state, 'merge');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.state.rules.length).toBeGreaterThanOrEqual(base.state.rules.length);
    for (const rule of base.state.rules) {
      if (pack.file === 'business-basics.json') continue;
      expect(added.state.rules.some((item) => item.id === rule.id), rule.id).toBe(true);
    }
  });
});

describe('束をまたいだ ID', () => {
  it('すべての束でルール ID が一意', () => {
    const all = packs.flatMap((pack) =>
      (readJson(pack.file) as { rules: { id: string }[] }).rules.map((rule) => rule.id),
    );
    // business-basics と payables で給与振込が重なるなど、意図した重複は許す。
    const duplicates = all.filter((id, index) => all.indexOf(id) !== index);
    expect(duplicates, `重複: ${duplicates.join(', ')}`).toEqual([]);
  });
});
