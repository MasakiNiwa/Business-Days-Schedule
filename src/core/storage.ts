/**
 * 永続化と入出力（docs/SPEC.md §9）。
 *
 * localStorage を正とする。使えない環境（プライベートモード等）では
 * メモリ上のフォールバックに退避し、呼び出し側が警告を出せるようにする。
 */

import type { BusinessCalendar, Rule } from '../types';
import { createDefaultCalendars, COMPANY_CALENDAR_ID } from './businessDay';
import { todayInTokyo } from './dateUtil';
import { hasError, validateCalendar, validateRule } from './validate';

export const SCHEMA_VERSION = 1;

const KEY_RULES = 'bds.v1.rules';
const KEY_CALENDARS = 'bds.v1.calendars';
const KEY_PREFS = 'bds.v1.prefs';
const KEY_SCHEMA_VERSION = 'bds.v1.schemaVersion';

export type Preferences = {
  defaultView: 'calendar' | 'list';
  /** 一覧表示で先読みする日数。 */
  listDays: number;
  /** 配色モード。'auto' は OS の設定に従う。 */
  theme: 'auto' | 'light' | 'dark';
};

export const DEFAULT_PREFERENCES: Preferences = {
  defaultView: 'calendar',
  listDays: 90,
  theme: 'auto',
};

export type AppState = {
  rules: Rule[];
  calendars: BusinessCalendar[];
  prefs: Preferences;
};

export type ExportFile = {
  schemaVersion: number;
  exportedAt: string;
  calendars: BusinessCalendar[];
  rules: Rule[];
  prefs: Preferences;
};

/** localStorage と同じ形の最小インタフェース。テストと非対応環境の差し替えに使う。 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/**
 * 利用可能なら localStorage を、そうでなければメモリストアを返す。
 * available が false のとき、UI は「この端末には保存されません」と警告する。
 */
export function resolveStore(): { store: KeyValueStore; available: boolean } {
  try {
    const probe = '__bds_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return { store: globalThis.localStorage, available: true };
  } catch {
    return { store: createMemoryStore(), available: false };
  }
}

function readJson<T>(store: KeyValueStore, key: string): T | null {
  const raw = store.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 壊れた値は無視して既定値へ倒す。ここで例外を投げるとアプリが起動できなくなる。
    return null;
  }
}

export function createDefaultState(): AppState {
  return {
    rules: [],
    calendars: createDefaultCalendars(),
    prefs: { ...DEFAULT_PREFERENCES },
  };
}

export function loadState(store: KeyValueStore): AppState {
  const defaults = createDefaultState();
  const rules = readJson<Rule[]>(store, KEY_RULES);
  const calendars = readJson<BusinessCalendar[]>(store, KEY_CALENDARS);
  const prefs = readJson<Partial<Preferences>>(store, KEY_PREFS);

  const validCalendars = Array.isArray(calendars)
    ? calendars.filter((calendar) => !hasError(validateCalendar(calendar)))
    : [];

  return {
    rules: Array.isArray(rules) ? rules.filter((rule) => !hasError(validateRule(rule))) : defaults.rules,
    // カレンダーが1件も残らないと営業日を計算できないため、必ず既定値へ戻す。
    calendars: validCalendars.length > 0 ? validCalendars : defaults.calendars,
    prefs: { ...defaults.prefs, ...(prefs ?? {}) },
  };
}

export function saveState(store: KeyValueStore, state: AppState): void {
  store.setItem(KEY_RULES, JSON.stringify(state.rules));
  store.setItem(KEY_CALENDARS, JSON.stringify(state.calendars));
  store.setItem(KEY_PREFS, JSON.stringify(state.prefs));
  store.setItem(KEY_SCHEMA_VERSION, String(SCHEMA_VERSION));
}

export function clearState(store: KeyValueStore): void {
  for (const key of [KEY_RULES, KEY_CALENDARS, KEY_PREFS, KEY_SCHEMA_VERSION]) {
    store.removeItem(key);
  }
}

// ---------------------------------------------------------------------------
// エクスポート / インポート (docs/SPEC.md §9.2)
// ---------------------------------------------------------------------------

export function buildExportFile(state: AppState, now: Date = new Date()): ExportFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    calendars: state.calendars,
    rules: state.rules,
    prefs: state.prefs,
  };
}

export function exportFileName(now: Date = new Date()): string {
  // 実行環境のタイムゾーンではなく日本時間の日付でファイル名を付ける。
  return `business-days-schedule-${todayInTokyo(now).replaceAll('-', '')}.json`;
}

export type ImportMode = 'replace' | 'merge';

export type ImportResult =
  | { ok: true; state: AppState; skipped: { rules: number; calendars: number } }
  | { ok: false; errors: string[] };

/**
 * エクスポートファイルを取り込む。
 * 検証に通らないルール／カレンダーは取り込まず、件数を skipped で返す。
 */
export function importState(raw: unknown, current: AppState, mode: ImportMode): ImportResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['ファイルの形式が不正です'] };
  }
  const file = raw as Partial<ExportFile>;
  if (typeof file.schemaVersion !== 'number') {
    errors.push('schemaVersion がありません');
  } else if (file.schemaVersion > SCHEMA_VERSION) {
    errors.push(`このアプリより新しい形式です (schemaVersion: ${file.schemaVersion})`);
  }
  if (!Array.isArray(file.rules)) errors.push('rules が配列ではありません');
  if (!Array.isArray(file.calendars)) errors.push('calendars が配列ではありません');
  if (errors.length > 0) return { ok: false, errors };

  const validRules = (file.rules ?? []).filter((rule) => !hasError(validateRule(rule)));
  const validCalendars = (file.calendars ?? []).filter(
    (calendar) => !hasError(validateCalendar(calendar)),
  );
  const skipped = {
    rules: (file.rules ?? []).length - validRules.length,
    calendars: (file.calendars ?? []).length - validCalendars.length,
  };

  if (mode === 'replace') {
    return {
      ok: true,
      skipped,
      state: {
        rules: validRules,
        // カレンダーが1件も無いと営業日計算ができないため既定値へ戻す。
        calendars: validCalendars.length > 0 ? validCalendars : createDefaultCalendars(),
        prefs: { ...DEFAULT_PREFERENCES, ...(file.prefs ?? {}) },
      },
    };
  }

  // merge: ID が衝突した場合は取り込み側を採用する。
  const mergeById = <T extends { id: string }>(base: T[], incoming: T[]): T[] => {
    const map = new Map(base.map((item) => [item.id, item]));
    for (const item of incoming) map.set(item.id, item);
    return [...map.values()];
  };

  return {
    ok: true,
    skipped,
    state: {
      rules: mergeById(current.rules, validRules),
      calendars: mergeById(current.calendars, validCalendars),
      prefs: { ...current.prefs, ...(file.prefs ?? {}) },
    },
  };
}

// ---------------------------------------------------------------------------
// ルール生成
// ---------------------------------------------------------------------------

export function newRuleId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createRule(overrides: Partial<Rule> = {}): Rule {
  const now = new Date().toISOString();
  return {
    id: newRuleId(),
    title: '',
    color: 'blue',
    enabled: true,
    calendarId: COMPANY_CALENDAR_ID,
    recurrence: { type: 'monthlyByDay', interval: 1, days: [1], overflow: 'clamp' },
    adjust: { mode: 'prev', keepInMonth: false },
    notices: [],
    period: { start: null, end: null },
    skipDates: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
