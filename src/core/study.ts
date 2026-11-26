/**
 * ルールを覚えるための学習（docs/SPEC.md §8.13）。
 *
 * 1枚のカードは1つのルール。「支払」を見て、いつ・休業日の扱い・前後の予定を
 * 思い出し、答え（ルールの説明とアプリが計算した日付）を見て自分で4段階に評価する。
 * 次にいつ復習するかは FSRS-7（ts-fsrs 6）が決める。
 *
 * 日付の計算（予定がいつ来るか）は、これまでどおり営業日カレンダーが行う。
 * ここで扱う「日付」は、復習の予定と、覚えている見込み（定着率）だけ。
 *
 * 学習の記録は端末のブラウザに保存する（ルールとは別のキー）。
 * 壊れた記録で画面が開けなくならないよう、読み込みでは1件ずつ確かめて捨てる。
 */

import { DefaultScheduler, Rating } from 'ts-fsrs';
import type { DateStr, Occurrence, Rule } from '../types';
import { ruleRevision } from './conflict';
import { addDays, addMonths, diffDays, parseDate, todayInTokyo } from './dateUtil';
import { expandRules } from './schedule';
import type { ScheduleContext } from './schedule';
import { DEFAULT_DESIRED_RETENTION, STUDY_LOG_LIMIT } from './studyData';
import type { StoredCard, StudyLog, StudyRating, StudyState } from './studyData';

export type Scheduler = Awaited<ReturnType<typeof createScheduler>>;
export type FsrsCard = Parameters<Scheduler['review']>[0]['card'];

export * from './studyData';

export const STUDY_RATINGS: readonly { rating: StudyRating; label: string }[] = [
  { rating: Rating.Again as StudyRating, label: 'もう一度' },
  { rating: Rating.Hard as StudyRating, label: '難しい' },
  { rating: Rating.Good as StudyRating, label: 'できた' },
  { rating: Rating.Easy as StudyRating, label: '簡単' },
];

// ---------------------------------------------------------------------------
// 計算（FSRS-7）
// ---------------------------------------------------------------------------

/**
 * 復習の予定を決める仕組み。FSRS-7（ts-fsrs 6 の既定）を使う。
 *
 * - 分単位の学習ステップは使わない（業務のルールは日単位で思い出せればよい）
 * - 間隔のゆらぎ（fuzz）は付けない。同じ評価なら同じ日になるほうが説明しやすい
 */
export function createScheduler(desiredRetention = DEFAULT_DESIRED_RETENTION) {
  return DefaultScheduler({
    version: 'FSRS-7',
    desiredRetention,
    enableShortTerm: false,
    enableFuzz: false,
    maximumInterval: 3650,
  });
}

function toCard(stored: StoredCard): FsrsCard {
  const { ruleRev: _ruleRev, ...rest } = stored;
  return {
    ...rest,
    dueAt: new Date(stored.dueAt),
    lastReviewAt: stored.lastReviewAt === null ? null : new Date(stored.lastReviewAt),
  } as FsrsCard;
}

function toStored(card: FsrsCard, ruleRev: string): StoredCard {
  const value = card as unknown as Record<string, unknown> & { dueAt: Date; lastReviewAt: Date | null };
  return {
    stability: value['stability'] as number,
    stabilityFast: value['stabilityFast'] as number,
    difficulty: value['difficulty'] as number,
    dueAt: value.dueAt.toISOString(),
    lastReviewAt: value.lastReviewAt === null ? null : value.lastReviewAt.toISOString(),
    state: value['state'] as number,
    scheduleStatus: String(value['scheduleStatus']),
    cardId: String(value['cardId']),
    reps: value['reps'] as number,
    lapses: value['lapses'] as number,
    scheduledDays: value['scheduledDays'] as number,
    learningStep: value['learningStep'] as number,
    ruleRev,
  };
}

/** その日の終わり（日本時間）。「今日までに復習するもの」の境目。 */
export function endOfDayTokyo(date: DateStr): Date {
  // 日本時間 23:59:59.999 は UTC の 14:59:59.999。
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day, 14, 59, 59, 999));
}

/** いま覚えている見込み（0〜1）。まだ覚えていないカードは null。 */
export function retrievabilityAt(scheduler: Scheduler, stored: StoredCard, at: Date): number | null {
  if (stored.lastReviewAt === null) return null;
  const card = toCard(stored);
  const elapsed = Math.max(0, scheduler.chrono.difference(new Date(stored.lastReviewAt), at));
  return scheduler.model.forgettingCurve(card, elapsed);
}

export type StudyStatus = 'new' | 'learning' | 'review' | 'relearning' | 'paused';

export type RuleProgress = {
  rule: Rule;
  card: StoredCard | null;
  status: StudyStatus;
  /** いま覚えている見込み（0〜1）。まだ覚えていなければ null。 */
  retrievability: number | null;
  /** 次に復習する日（日本時間）。まだ覚えていなければ null。 */
  dueDate: DateStr | null;
  /** 今日までに復習するか。 */
  due: boolean;
  /** 最後に評価したあとで、ルールの中身が変わったか。 */
  changed: boolean;
};

const STATUS_BY_STATE: Record<number, StudyStatus> = { 0: 'new', 1: 'learning', 2: 'review', 3: 'relearning' };

export function progressOf(
  rules: readonly Rule[],
  state: StudyState,
  scheduler: Scheduler,
  now: Date,
  today: DateStr,
): RuleProgress[] {
  const endOfToday = endOfDayTokyo(today).getTime();
  return rules.map((rule) => {
    const card = Object.hasOwn(state.cards, rule.id) ? (state.cards[rule.id] ?? null) : null;
    if (!rule.enabled) {
      return { rule, card, status: 'paused', retrievability: null, dueDate: null, due: false, changed: false };
    }
    if (card === null || card.lastReviewAt === null) {
      return { rule, card, status: 'new', retrievability: null, dueDate: null, due: false, changed: false };
    }
    return {
      rule,
      card,
      status: STATUS_BY_STATE[card.state] ?? 'review',
      retrievability: retrievabilityAt(scheduler, card, now),
      dueDate: todayInTokyo(new Date(card.dueAt)),
      due: Date.parse(card.dueAt) <= endOfToday,
      changed: card.ruleRev !== '' && card.ruleRev !== ruleRevision(rule),
    };
  });
}

/** 今日すでに新しく覚えた数。 */
export function newLearnedOn(state: StudyState, today: DateStr): number {
  return state.logs.filter((log) => log.wasNew && todayInTokyo(new Date(log.at)) === today).length;
}

/**
 * 今日の復習の順番。期限の来たものを期限の古い順に、そのあとに新しいものを
 * 1日の上限まで（ルール一覧の順）。一時停止中のルールは入れない。
 */
export function buildQueue(progress: readonly RuleProgress[], state: StudyState, today: DateStr): RuleProgress[] {
  const due = progress
    .filter((item) => item.status !== 'new' && item.status !== 'paused' && item.due)
    .sort((a, b) => Date.parse(a.card?.dueAt ?? '') - Date.parse(b.card?.dueAt ?? ''));
  const fresh = progress.filter((item) => item.status === 'new');
  const room = state.newPerDay === 0 ? fresh.length : Math.max(0, state.newPerDay - newLearnedOn(state, today));
  return [...due, ...fresh.slice(0, room)];
}

/** 1枚を評価する。元の状態は変えずに、新しい状態を返す。 */
export function reviewRule(
  state: StudyState,
  scheduler: Scheduler,
  rule: Rule,
  rating: StudyRating,
  now: Date,
): StudyState {
  const stored = Object.hasOwn(state.cards, rule.id) ? state.cards[rule.id] : undefined;
  const card = stored === undefined ? (scheduler.newCard({ now }) as FsrsCard) : toCard(stored);
  const wasNew = stored === undefined || stored.lastReviewAt === null;
  const before = stored === undefined ? null : retrievabilityAt(scheduler, stored, now);
  const result = scheduler.review({ card, grade: rating, now });
  const log: StudyLog = { ruleId: rule.id, at: now.toISOString(), rating, wasNew, retrievability: before };
  return {
    ...state,
    cards: { ...state.cards, [rule.id]: toStored(result.card, ruleRevision(rule)) },
    logs: [...state.logs, log].slice(-STUDY_LOG_LIMIT),
  };
}

/** 「今日」「明日」「5日後」「約2か月後」のような、次の復習までの言い方。 */
export function describeDue(today: DateStr, dueDate: DateStr): string {
  const days = diffDays(today, dueDate);
  if (days <= 0) return '今日';
  if (days === 1) return '明日';
  if (days < 60) return `${days}日後`;
  if (days < 365) return `約${Math.round(days / 30)}か月後`;
  return `約${Math.round((days / 365) * 10) / 10}年後`;
}

/** 4つの評価それぞれで、次の復習がいつになるか。ボタンに添えて見せる。 */
export function previewNext(
  scheduler: Scheduler,
  state: StudyState,
  rule: Rule,
  now: Date,
  today: DateStr,
): Record<StudyRating, string> {
  const stored = Object.hasOwn(state.cards, rule.id) ? state.cards[rule.id] : undefined;
  const card = stored === undefined ? (scheduler.newCard({ now }) as FsrsCard) : toCard(stored);
  const labels = {} as Record<StudyRating, string>;
  for (const item of scheduler.preview({ card, now })) {
    const next = item.card as unknown as { dueAt: Date };
    labels[item.grade as StudyRating] = describeDue(today, todayInTokyo(next.dueAt));
  }
  return labels;
}

/** 忘却曲線。最後に評価した日から days 日ぶんの、覚えている見込み。 */
export function forgettingCurve(
  scheduler: Scheduler,
  stored: StoredCard,
  days: number,
  step = 1,
): { day: number; retrievability: number }[] {
  if (stored.lastReviewAt === null) return [];
  const card = toCard(stored);
  const points: { day: number; retrievability: number }[] = [];
  for (let day = 0; day <= days; day += step) {
    points.push({ day, retrievability: scheduler.model.forgettingCurve(card, day) });
  }
  return points;
}

/** 今日から days 日ぶんの、日ごとの復習の数。期限を過ぎたものは今日に数える。 */
export function forecast(
  progress: readonly RuleProgress[],
  today: DateStr,
  days = 14,
): { date: DateStr; count: number }[] {
  const counts = new Map<DateStr, number>();
  for (let offset = 0; offset < days; offset += 1) counts.set(addDays(today, offset), 0);
  for (const item of progress) {
    if (item.dueDate === null || item.status === 'paused') continue;
    const date = item.dueDate < today ? today : item.dueDate;
    if (counts.has(date)) counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return [...counts].map(([date, count]) => ({ date, count }));
}

export type StudySummary = {
  /** 学習の対象（一時停止中を除くルール）。 */
  total: number;
  /** 一度でも覚えたもの。 */
  learned: number;
  /** 今日までに復習するもの。 */
  due: number;
  /** 今日新しく覚えられる残り。 */
  newToday: number;
  /** 覚えたものの、覚えている見込みの平均（0〜1）。覚えたものが無ければ null。 */
  averageRetention: number | null;
};

export function summarize(progress: readonly RuleProgress[], state: StudyState, today: DateStr): StudySummary {
  const active = progress.filter((item) => item.status !== 'paused');
  const learned = active.filter((item) => item.retrievability !== null);
  const queue = buildQueue(progress, state, today);
  return {
    total: active.length,
    learned: learned.length,
    due: queue.filter((item) => item.status !== 'new').length,
    newToday: queue.filter((item) => item.status === 'new').length,
    averageRetention:
      learned.length === 0
        ? null
        : learned.reduce((sum, item) => sum + (item.retrievability ?? 0), 0) / learned.length,
  };
}

/** そのルールの最近の評価（新しい順）。 */
export function recentLogs(state: StudyState, ruleId: string, limit = 5): StudyLog[] {
  return state.logs.filter((log) => log.ruleId === ruleId).slice(-limit).reverse();
}

/**
 * 過去に実際に来た予定（本体）。今日より前の months か月ぶんから、新しい順に limit 件。
 * 休業日で動いた回も、動いたあとの日で返す（Occurrence の shifted で分かる）。
 */
export function pastOccurrences(
  rule: Rule,
  ctx: ScheduleContext,
  today: DateStr,
  months = 6,
  limit = 6,
): Occurrence[] {
  const range = { start: addMonths(today, -months), end: addDays(today, -1) };
  // 一時停止中でも、過去に来た日は振り返れるようにする。
  const { occurrences } = expandRules([{ ...rule, enabled: true }], range, ctx);
  return occurrences
    .filter((occurrence) => occurrence.kind === 'main')
    .reverse()
    .slice(0, limit);
}
