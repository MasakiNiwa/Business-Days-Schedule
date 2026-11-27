/**
 * 学習の記録の形と、保存・読み込み・取り込み（docs/SPEC.md §8.13）。
 *
 * 計算（ts-fsrs）とは分けておく。バックアップの書き出し・読み込みはアプリ本体が
 * 行うので、ここが ts-fsrs を読み込むと、学習の画面を開かない人にも
 * 計算の部品を配ることになる。
 */

import type { Rule } from '../types';
import type { KeyValueStore } from './storage';

/** 1 = もう一度, 2 = 難しい, 3 = できた, 4 = 簡単。ts-fsrs の Rating と同じ値。 */
export type StudyRating = 1 | 2 | 3 | 4;

export const STUDY_KEY = 'bds.v1.study';
export const STUDY_VERSION = 1;

/** 目標の定着率の選択肢。高いほど復習が増える。 */
export const DESIRED_RETENTION_CHOICES: readonly number[] = [0.8, 0.85, 0.9, 0.95];
export const DEFAULT_DESIRED_RETENTION = 0.9;

/** 1日に新しく覚えるルールの数。0 は「制限なし」。 */
export const NEW_PER_DAY_CHOICES: readonly number[] = [5, 10, 20, 0];
export const DEFAULT_NEW_PER_DAY = 10;

/** 週の予定の問題。先週・今週・来週の3つ。 */
export type WeekKey = 'last' | 'this' | 'next';
export const WEEK_KEYS: readonly WeekKey[] = ['last', 'this', 'next'];
export const weekCardId = (key: WeekKey): string => `week:${key}`;
export const WEEK_CARD_IDS: readonly string[] = WEEK_KEYS.map(weekCardId);

/** 残す評価の記録の数。古いものから捨てる。 */
export const STUDY_LOG_LIMIT = 2000;

/** 保存する形。ts-fsrs のカードの日時を ISO 文字列にしたもの。 */
export type StoredCard = {
  stability: number;
  stabilityFast: number;
  difficulty: number;
  dueAt: string;
  lastReviewAt: string | null;
  state: number;
  scheduleStatus: string;
  cardId: string;
  reps: number;
  lapses: number;
  scheduledDays: number;
  learningStep: number;
  /**
   * 最後に評価したときのルールの印。ルールが変わったことに気づくため。
   * 週の予定の問題では、対象の週（"week:2026-11-23"）。週が替われば別の問題として覚え直す。
   */
  ruleRev: string;
};

export type StudyLog = {
  ruleId: string;
  /** 評価した日時（ISO）。 */
  at: string;
  rating: StudyRating;
  /** 初めて覚えたときか。1日の新しいカードの数を数えるのに使う。 */
  wasNew: boolean;
  /** 評価する直前に覚えていた見込み。初めてなら null。 */
  retrievability: number | null;
};

export type StudyState = {
  version: typeof STUDY_VERSION;
  desiredRetention: number;
  newPerDay: number;
  /** 先週・今週・来週の予定を思い浮かべる問題を出すか。 */
  weekCards: boolean;
  /** ルールの id → カード。 */
  cards: Record<string, StoredCard>;
  logs: StudyLog[];
};

export function createStudyState(): StudyState {
  return {
    version: STUDY_VERSION,
    desiredRetention: DEFAULT_DESIRED_RETENTION,
    newPerDay: DEFAULT_NEW_PER_DAY,
    weekCards: true,
    cards: {},
    logs: [],
  };
}


const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isIsoTime = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));

function readCard(value: unknown): StoredCard | null {
  if (!isRecord(value)) return null;
  const numbers = ['stability', 'stabilityFast', 'difficulty', 'state', 'reps', 'lapses', 'scheduledDays', 'learningStep'];
  if (!numbers.every((key) => isFiniteNumber(value[key]))) return null;
  if (!isIsoTime(value['dueAt'])) return null;
  const last = value['lastReviewAt'];
  if (last !== null && !isIsoTime(last)) return null;
  if (typeof value['scheduleStatus'] !== 'string' || typeof value['cardId'] !== 'string') return null;
  return {
    stability: value['stability'] as number,
    stabilityFast: value['stabilityFast'] as number,
    difficulty: value['difficulty'] as number,
    dueAt: value['dueAt'],
    lastReviewAt: last as string | null,
    state: value['state'] as number,
    scheduleStatus: value['scheduleStatus'],
    cardId: value['cardId'],
    reps: value['reps'] as number,
    lapses: value['lapses'] as number,
    scheduledDays: value['scheduledDays'] as number,
    learningStep: value['learningStep'] as number,
    ruleRev: typeof value['ruleRev'] === 'string' ? value['ruleRev'] : '',
  };
}

function readLog(value: unknown): StudyLog | null {
  if (!isRecord(value)) return null;
  const rating = value['rating'];
  if (typeof value['ruleId'] !== 'string' || !isIsoTime(value['at'])) return null;
  if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) return null;
  const retrievability = value['retrievability'];
  return {
    ruleId: value['ruleId'],
    at: value['at'],
    rating,
    wasNew: value['wasNew'] === true,
    retrievability: isFiniteNumber(retrievability) ? retrievability : null,
  };
}

/**
 * 保存されている形を確かめて読む。知らない形・壊れたものは捨て、捨てた数を返す。
 * 学習の記録が壊れていても、予定の画面は使えなければならない。
 */
export function parseStudyState(raw: unknown): { state: StudyState; dropped: number } {
  const state = createStudyState();
  if (!isRecord(raw) || raw['version'] !== STUDY_VERSION) {
    return { state, dropped: raw === null || raw === undefined ? 0 : 1 };
  }
  let dropped = 0;
  const retention = raw['desiredRetention'];
  if (isFiniteNumber(retention) && DESIRED_RETENTION_CHOICES.includes(retention)) state.desiredRetention = retention;
  const perDay = raw['newPerDay'];
  if (isFiniteNumber(perDay) && NEW_PER_DAY_CHOICES.includes(perDay)) state.newPerDay = perDay;
  if (raw['weekCards'] === false) state.weekCards = false;
  const cards = raw['cards'];
  if (isRecord(cards)) {
    for (const ruleId of Object.keys(cards)) {
      const card = readCard(cards[ruleId]);
      if (card === null) dropped += 1;
      else state.cards[ruleId] = card;
    }
  }
  const logs = raw['logs'];
  if (Array.isArray(logs)) {
    for (const item of logs.slice(-STUDY_LOG_LIMIT)) {
      const log = readLog(item);
      if (log === null) dropped += 1;
      else state.logs.push(log);
    }
  }
  return { state, dropped };
}

export function loadStudyState(store: KeyValueStore): { state: StudyState; dropped: number } {
  let raw: unknown = null;
  try {
    const text = store.getItem(STUDY_KEY);
    raw = text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return { state: createStudyState(), dropped: 1 };
  }
  return parseStudyState(raw);
}

export function saveStudyState(store: KeyValueStore, state: StudyState): void {
  store.setItem(STUDY_KEY, JSON.stringify(state));
}

/** 消したルールのカードと記録を外す。残しておくと件数や平均が合わなくなる。 */
export function pruneStudyState(state: StudyState, rules: readonly Rule[]): StudyState {
  // 週の予定の問題（week:…）はルールに紐づかないので残す。
  const ids = new Set([...rules.map((rule) => rule.id), ...WEEK_CARD_IDS]);
  const stale = Object.keys(state.cards).filter((id) => !ids.has(id));
  const staleLogs = state.logs.some((log) => !ids.has(log.ruleId));
  if (stale.length === 0 && !staleLogs) return state;
  const cards: Record<string, StoredCard> = {};
  for (const [id, card] of Object.entries(state.cards)) if (ids.has(id)) cards[id] = card;
  return { ...state, cards, logs: state.logs.filter((log) => ids.has(log.ruleId)) };
}

/** バックアップの JSON から学習の記録を取り出す。含まれていなければ null。 */
export function studyFromBackup(raw: unknown): StudyState | null {
  if (!isRecord(raw) || !Object.hasOwn(raw, 'study')) return null;
  return parseStudyState(raw['study']).state;
}

/**
 * バックアップの学習の記録を、今の記録と合わせる（読み込みの「追加・上書き」）。
 *
 * カードは、最後に評価したのが新しいほうを残す。評価の記録は、同じルール・同じ日時の
 * ものを1つにして日時順に並べる。設定（目標の定着率など）は今のものを残す。
 */
export function mergeStudyStates(current: StudyState, incoming: StudyState): StudyState {
  const cards: Record<string, StoredCard> = { ...current.cards };
  const reviewedAt = (card: StoredCard | undefined): number =>
    card?.lastReviewAt === null || card === undefined ? -Infinity : Date.parse(card.lastReviewAt);
  for (const [ruleId, card] of Object.entries(incoming.cards)) {
    const mine = Object.hasOwn(cards, ruleId) ? cards[ruleId] : undefined;
    if (reviewedAt(card) > reviewedAt(mine)) cards[ruleId] = card;
  }
  const seen = new Set<string>();
  const logs = [...current.logs, ...incoming.logs]
    .filter((log) => {
      const key = `${log.ruleId}\u0000${log.at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-STUDY_LOG_LIMIT);
  return { ...current, cards, logs };
}
