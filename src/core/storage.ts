/**
 * 永続化と入出力（docs/SPEC.md §9）。
 *
 * localStorage を正とする。使えない環境（プライベートモード等）では
 * メモリ上のフォールバックに退避し、呼び出し側が警告を出せるようにする。
 */

import type { BusinessCalendar, Rule } from '../types';
import { createDefaultCalendars, COMPANY_CALENDAR_ID } from './businessDay';
import { todayInTokyo } from './dateUtil';
import { normalizeRule } from './notice';
import { LIMITS, hasError, quarantineCalendar, validateCalendar, validateRule } from './validate';

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
  /**
   * カレンダーのセルに予定をどう出すか。
   * 'text' は予定名まで出す（既定）。'dot' は点だけにして1か月を見渡しやすくする。
   * 画面幅から勝手に決めず、利用者が選んだものを覚える。
   */
  chipDisplay: 'text' | 'dot';
  /**
   * 表示するグループ。null は「すべて」。空文字は未分類を指す。
   *
   * 「税務」と「入金」だけを見比べたい、のような使い方があるので複数持てる。
   */
  activeGroups: string[] | null;
  /** 追加済みのサンプル束。再読込しても「追加済み」を保てるよう保存する。 */
  addedSamplePacks: string[];
};

/**
 * 表示するグループの読み込み。
 *
 * 以前は1つだけを文字列で持っていたので、そちらも受け取って配列に均す。
 * 未分類（空文字）は以前の読み込みで落とされていたが、選べる以上は覚える。
 */
function readActiveGroups(
  value: Record<string, unknown>,
  defaults: Preferences,
): string[] | null {
  const raw = value['activeGroups'];
  if (Array.isArray(raw)) {
    const groups = raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.slice(0, LIMITS.groupLength))
      .slice(0, 100);
    return groups.length === 0 ? null : [...new Set(groups)];
  }
  // 旧形式。1つだけ選んでいた状態をそのまま引き継ぐ。
  const legacy = value['activeGroup'];
  if (typeof legacy === 'string') return [legacy.slice(0, LIMITS.groupLength)];
  return defaults.activeGroups === null ? null : [...defaults.activeGroups];
}

export const DEFAULT_PREFERENCES: Preferences = {
  defaultView: 'calendar',
  listDays: 30,
  theme: 'auto',
  chipDisplay: 'text',
  activeGroups: null,
  addedSamplePacks: [],
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

/**
 * 検証を通ったものだけを残す。検証そのものが落ちた場合もその1件だけを捨てる。
 * localStorage の中身は外から来る任意の値であり、1件の破損で起動不能にしてはいけない。
 */
function keepValid<T>(items: unknown, validate: (item: T) => { severity: string }[]): {
  kept: T[];
  dropped: number;
} {
  if (!Array.isArray(items)) return { kept: [], dropped: 0 };
  const kept: T[] = [];
  let dropped = 0;
  for (const item of items) {
    try {
      if (hasError(validate(item as T) as never)) dropped += 1;
      else kept.push(item as T);
    } catch {
      dropped += 1;
    }
  }
  return { kept, dropped };
}

export type LoadResult = AppState & {
  /** 壊れていて読み込まなかった件数。0 でなければ利用者に知らせる。 */
  droppedRules: number;
  droppedCalendars: number;
  /** カレンダーは残したが、取り除いた休業期間の件数。 */
  quarantinedRanges: number;
};

/**
 * 隔離してから検証する。休業期間が1件不正なだけでカレンダーごと捨てると、
 * 週末の曜日も臨時営業日も決算月も一緒に消える。そのカレンダーを参照する
 * ルールは代替カレンダーで計算されるので、日付が静かにずれる。
 */
function keepValidCalendars(items: unknown): { kept: BusinessCalendar[]; dropped: number; quarantined: number } {
  if (!Array.isArray(items)) return { kept: [], dropped: 0, quarantined: 0 };
  const kept: BusinessCalendar[] = [];
  let dropped = 0;
  let quarantined = 0;
  for (const item of items) {
    try {
      const repaired = quarantineCalendar(item);
      if (hasError(validateCalendar(repaired.calendar as BusinessCalendar))) {
        dropped += 1;
        continue;
      }
      kept.push(repaired.calendar as BusinessCalendar);
      quarantined += repaired.quarantined;
    } catch {
      dropped += 1;
    }
  }
  return { kept, dropped, quarantined };
}

export function loadState(store: KeyValueStore): LoadResult {
  const defaults = createDefaultState();
  const rules = readJson<unknown>(store, KEY_RULES);
  const calendars = readJson<unknown>(store, KEY_CALENDARS);
  const prefs = readJson<Partial<Preferences>>(store, KEY_PREFS);

  // 読み込んだ時点で前後予定の id を補う。以後は順番が変わっても識別子が動かない。
  const ruleResult = keepValid<Rule>(rules, validateRule);
  ruleResult.kept = ruleResult.kept.map(normalizeRule);
  const calendarResult = keepValidCalendars(calendars);

  return {
    rules: Array.isArray(rules) ? ruleResult.kept : defaults.rules,
    // カレンダーが1件も残らないと営業日を計算できないため、必ず既定値へ戻す。
    calendars: calendarResult.kept.length > 0 ? calendarResult.kept : defaults.calendars,
    prefs: normalizePreferences(prefs, defaults.prefs),
    droppedRules: ruleResult.dropped,
    droppedCalendars: calendarResult.dropped,
    quarantinedRanges: calendarResult.quarantined,
  };
}

/** 表示設定も外から来るため、列挙値と範囲を確かめてから採用する。 */
function normalizePreferences(input: unknown, defaults: Preferences): Preferences {
  if (typeof input !== 'object' || input === null) return { ...defaults };
  const value = input as Record<string, unknown>;
  const listDays = Number(value['listDays']);
  return {
    defaultView: value['defaultView'] === 'list' ? 'list' : defaults.defaultView,
    listDays:
      Number.isInteger(listDays) && listDays >= 1 && listDays <= 1096 ? listDays : defaults.listDays,
    theme:
      value['theme'] === 'light' || value['theme'] === 'dark' || value['theme'] === 'auto'
        ? value['theme']
        : defaults.theme,
    chipDisplay: value['chipDisplay'] === 'dot' ? 'dot' : defaults.chipDisplay,
    activeGroups: readActiveGroups(value, defaults),
    addedSamplePacks: Array.isArray(value['addedSamplePacks'])
      ? value['addedSamplePacks'].filter((id): id is string => typeof id === 'string').slice(0, 50)
      : [...defaults.addedSamplePacks],
  };
}

export function saveState(store: KeyValueStore, state: AppState): void {
  store.setItem(KEY_RULES, JSON.stringify(state.rules));
  store.setItem(KEY_CALENDARS, JSON.stringify(state.calendars));
  store.setItem(KEY_PREFS, JSON.stringify(state.prefs));
  store.setItem(KEY_SCHEMA_VERSION, String(SCHEMA_VERSION));
}

/**
 * 表示の好みだけを保存する。
 *
 * 一覧の日数や配色を変えただけで全部を書き戻すと、別のタブが持っている
 * 古いルール一覧で上書きしてしまう。実際に、片方のタブで作ったルールが
 * もう片方の表示切り替えで消えた。触っていないものは触らない。
 */
export function savePreferences(store: KeyValueStore, prefs: Preferences): void {
  store.setItem(KEY_PREFS, JSON.stringify(prefs));
  store.setItem(KEY_SCHEMA_VERSION, String(SCHEMA_VERSION));
}

/** ルールだけを保存する。カレンダーと表示の好みには触れない。 */
export function saveRules(store: KeyValueStore, rules: readonly Rule[]): void {
  store.setItem(KEY_RULES, JSON.stringify(rules));
  store.setItem(KEY_SCHEMA_VERSION, String(SCHEMA_VERSION));
}

/** 営業日カレンダーだけを保存する。 */
export function saveCalendars(store: KeyValueStore, calendars: readonly BusinessCalendar[]): void {
  store.setItem(KEY_CALENDARS, JSON.stringify(calendars));
  store.setItem(KEY_SCHEMA_VERSION, String(SCHEMA_VERSION));
}

/** 別のタブが書き換えたら知りたいキー。 */
export const STORAGE_KEYS = {
  rules: KEY_RULES,
  calendars: KEY_CALENDARS,
  prefs: KEY_PREFS,
} as const;

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

/**
 * replace … 置き換える
 * merge   … 取り込み側で上書きする（明示的に元へ戻したいとき）
 * add     … 既存の ID は触らず、無いものだけ足す（サンプル追加の既定）
 */
export type ImportMode = 'replace' | 'merge' | 'add';

export type ImportResult =
  | {
      ok: true;
      state: AppState;
      /** 形式が不正で取り込まなかった件数。 */
      skipped: { rules: number; calendars: number };
      /** 既に同じ ID があるため触らなかった件数（add のみ）。 */
      untouched: { rules: number; calendars: number };
      /** 実際に追加・更新した件数。 */
      applied: { rules: number; calendars: number };
    }
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

  // 取り込んだルールにも、その場で前後予定の id を補う。
  const validRules = (file.rules ?? [])
    .filter((rule): rule is Rule => !hasError(validateRule(rule)))
    .map(normalizeRule);
  // 取り込みでも、不正な休業期間だけを外して残りを生かす。読み込みと揃える。
  const validCalendars = (file.calendars ?? [])
    .map((calendar) => quarantineCalendar(calendar).calendar as BusinessCalendar)
    .filter((calendar) => !hasError(validateCalendar(calendar)));
  const skipped = {
    rules: (file.rules ?? []).length - validRules.length,
    calendars: (file.calendars ?? []).length - validCalendars.length,
  };

  if (mode === 'replace') {
    return {
      ok: true,
      skipped,
      untouched: { rules: 0, calendars: 0 },
      applied: { rules: validRules.length, calendars: validCalendars.length },
      state: {
        rules: validRules,
        // カレンダーが1件も無いと営業日計算ができないため既定値へ戻す。
        calendars: validCalendars.length > 0 ? validCalendars : createDefaultCalendars(),
        prefs: normalizePreferences(file.prefs, DEFAULT_PREFERENCES),
      },
    };
  }

  /**
   * merge は取り込み側で上書き、add は既存を残す。
   * サンプルの追加で既定を add にしているのは、利用者が編集した内容を
   * 無言で元へ戻してしまわないため。
   */
  const combine = <T extends { id: string }>(
    base: T[],
    incoming: T[],
  ): { items: T[]; applied: number; untouched: number } => {
    const map = new Map(base.map((item) => [item.id, item]));
    let applied = 0;
    let untouched = 0;
    for (const item of incoming) {
      if (mode === 'add' && map.has(item.id)) {
        untouched += 1;
        continue;
      }
      map.set(item.id, item);
      applied += 1;
    }
    return { items: [...map.values()], applied, untouched };
  };

  const rules = combine(current.rules, validRules);
  const calendars = combine(current.calendars, validCalendars);

  return {
    ok: true,
    skipped,
    untouched: { rules: rules.untouched, calendars: calendars.untouched },
    applied: { rules: rules.applied, calendars: calendars.applied },
    state: {
      rules: rules.items,
      calendars: calendars.items,
      prefs: normalizePreferences({ ...current.prefs, ...(file.prefs ?? {}) }, current.prefs),
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
