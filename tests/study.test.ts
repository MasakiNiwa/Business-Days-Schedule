/**
 * ルールを覚える学習（docs/SPEC.md §8.13）。FSRS-7（ts-fsrs 6）。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { ruleRevision } from '../src/core/conflict';
import { createMemoryStore } from '../src/core/storage';
import {
  buildQueue,
  createScheduler,
  createStudyState,
  describeDue,
  forecast,
  forgettingCurve,
  loadStudyState,
  newLearnedOn,
  parseStudyState,
  pastOccurrences,
  previewNext,
  progressOf,
  pruneStudyState,
  recentLogs,
  retrievabilityAt,
  reviewRule,
  saveStudyState,
  STUDY_KEY,
  STUDY_LOG_LIMIT,
  summarize,
} from '../src/core/study';
import type { Scheduler, StudyState } from '../src/core/study';
import type { Rule } from '../src/types';
import { makeRule, scheduleContext } from './helpers';

let scheduler: Scheduler;
beforeAll(async () => {
  scheduler = await createScheduler();
});

const payment = makeRule({
  id: 'pay',
  title: '支払',
  calendarId: 'bank',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
});
const closing = makeRule({ id: 'close', title: '月次締め' });
const paused = makeRule({ id: 'paused', title: '止めている予定', enabled: false });
const rules: Rule[] = [payment, closing, paused];

const today = '2026-11-25';
const now = new Date('2026-11-25T01:00:00.000Z'); // 日本時間 10:00

describe('FSRS-7 で復習の予定を決める', () => {
  it('初めて「できた」を付けると、数日後に復習する', () => {
    const state = reviewRule(createStudyState(), scheduler, payment, 3, now);
    const card = state.cards['pay'];
    expect(card?.reps).toBe(1);
    expect(card?.lastReviewAt).toBe(now.toISOString());
    expect(Date.parse(card?.dueAt ?? '')).toBeGreaterThan(now.getTime() + 86_400_000);
    // FSRS-7 は「速い記憶」の安定性も持つ。
    expect(card?.stabilityFast).toBeGreaterThan(0);
    expect(card?.ruleRev).toBe(ruleRevision(payment));
    expect(state.logs).toEqual([
      { ruleId: 'pay', at: now.toISOString(), rating: 3, wasNew: true, retrievability: null },
    ]);
  });

  it('評価が高いほど、次の復習は先になる', () => {
    const labels = previewNext(scheduler, createStudyState(), payment, now, today);
    const days = (rating: 1 | 2 | 3 | 4) => {
      const state = reviewRule(createStudyState(), scheduler, payment, rating, now);
      return Date.parse(state.cards['pay']?.dueAt ?? '');
    };
    expect(days(1)).toBeLessThanOrEqual(days(2));
    expect(days(2)).toBeLessThan(days(3));
    expect(days(3)).toBeLessThan(days(4));
    expect(labels[1]).toBe('今すぐ');
    expect(labels[4]).toMatch(/日後|か月後/);
  });

  it('元の状態は変えない', () => {
    const state = createStudyState();
    reviewRule(state, scheduler, payment, 3, now);
    expect(state.cards).toEqual({});
    expect(state.logs).toEqual([]);
  });

  it('覚えている見込みは、時間がたつほど下がる', () => {
    const card = reviewRule(createStudyState(), scheduler, payment, 3, now).cards['pay']!;
    const later = (days: number) => new Date(now.getTime() + days * 86_400_000);
    const r1 = retrievabilityAt(scheduler, card, later(1))!;
    const r10 = retrievabilityAt(scheduler, card, later(10))!;
    expect(r1).toBeLessThanOrEqual(1);
    expect(r10).toBeLessThan(r1);
    const curve = forgettingCurve(scheduler, card, 30, 10);
    expect(curve.map((point) => point.day)).toEqual([0, 10, 20, 30]);
    expect(curve[3]!.retrievability).toBeLessThan(curve[0]!.retrievability);
  });
});

describe('進み具合と今日の復習', () => {
  function learned(): StudyState {
    let state = createStudyState();
    state = reviewRule(state, scheduler, payment, 3, new Date('2026-11-01T01:00:00.000Z'));
    return state;
  }

  it('まだ覚えていないもの・一時停止中のものを見分ける', () => {
    const progress = progressOf(rules, learned(), scheduler, now, today);
    expect(progress.map((item) => [item.rule.id, item.status])).toEqual([
      ['pay', 'review'],
      ['close', 'new'],
      ['paused', 'paused'],
    ]);
    expect(progress[0]?.retrievability).toBeGreaterThan(0);
    expect(progress[0]?.retrievability).toBeLessThan(1);
    expect(progress[0]?.due).toBe(true);
    expect(progress[0]?.dueDate! <= today).toBe(true);
  });

  it('期限の来たものを先に、新しいものは1日の上限まで並べる。一時停止中は入れない', () => {
    const state = { ...learned(), newPerDay: 5 };
    const queue = buildQueue(progressOf(rules, state, scheduler, now, today), state, today);
    expect(queue.map((item) => item.rule.id)).toEqual(['pay', 'close']);

    // 今日すでに上限まで新しく覚えていれば、新しいものは出さない。
    const busy: StudyState = { ...state, newPerDay: 5 };
    busy.logs = Array.from({ length: 5 }, () => ({ ruleId: 'x', at: now.toISOString(), rating: 3 as const, wasNew: true, retrievability: null }));
    expect(newLearnedOn(busy, today)).toBe(5);
    expect(buildQueue(progressOf(rules, busy, scheduler, now, today), busy, today).map((item) => item.rule.id)).toEqual(['pay']);
    // 0 は制限なし。
    const unlimited = { ...busy, newPerDay: 0 };
    expect(buildQueue(progressOf(rules, unlimited, scheduler, now, today), unlimited, today)).toHaveLength(2);
  });

  it('ルールを変えたら、変わったことに気づける', () => {
    const progress = progressOf([{ ...payment, title: '支払（本社）' }], learned(), scheduler, now, today);
    expect(progress[0]?.changed).toBe(true);
  });

  it('まとめの数字', () => {
    const state = learned();
    const summary = summarize(progressOf(rules, state, scheduler, now, today), state, today);
    expect(summary).toMatchObject({ total: 2, learned: 1, due: 1, newToday: 1 });
    expect(summary.averageRetention).toBeGreaterThan(0);
  });

  it('これからの復習の数を日ごとに数える（期限切れは今日に入れる）', () => {
    const state = learned();
    const days = forecast(progressOf(rules, state, scheduler, now, today), today, 7);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ date: today, count: 1 });
    expect(days.slice(1).every((day) => day.count === 0)).toBe(true);
  });

  it('最近の評価を新しい順に返す', () => {
    let state = learned();
    state = reviewRule(state, scheduler, payment, 1, now);
    expect(recentLogs(state, 'pay').map((log) => log.rating)).toEqual([1, 3]);
    expect(recentLogs(state, 'pay')[0]?.retrievability).toBeGreaterThan(0);
  });
});

describe('describeDue', () => {
  it('次の復習までを言葉で言う', () => {
    expect(describeDue(today, today)).toBe('今日');
    expect(describeDue(today, '2026-11-24')).toBe('今日');
    expect(describeDue(today, '2026-11-26')).toBe('明日');
    expect(describeDue(today, '2026-12-05')).toBe('10日後');
    expect(describeDue(today, '2027-03-25')).toBe('約4か月後');
    expect(describeDue(today, '2028-11-25')).toBe('約2年後');
  });
});

describe('過去に実際に来た予定', () => {
  it('今日より前の本体の日付を、新しい順に返す（休業日で動いた回は動いた日）', () => {
    const past = pastOccurrences(payment, scheduleContext, today, 3, 3);
    expect(past.map((occurrence) => occurrence.date)).toEqual(['2026-10-23', '2026-09-25', '2026-08-25']);
    expect(past[0]?.shifted).toBe(true);
    expect(past[0]?.rawDate).toBe('2026-10-25');
  });

  it('一時停止中のルールでも振り返れる', () => {
    expect(pastOccurrences({ ...payment, enabled: false }, scheduleContext, today, 2, 1)).toHaveLength(1);
  });
});

describe('保存と読み込み', () => {
  it('保存したものをそのまま読み戻し、続けて復習できる', () => {
    const store = createMemoryStore();
    const state = reviewRule(createStudyState(), scheduler, payment, 3, now);
    saveStudyState(store, state);
    const { state: loaded, dropped } = loadStudyState(store);
    expect(dropped).toBe(0);
    expect(loaded).toEqual(state);
    const next = reviewRule(loaded, scheduler, payment, 3, new Date('2026-12-10T01:00:00.000Z'));
    expect(next.cards['pay']?.reps).toBe(2);
  });

  it('壊れたカードや記録は捨て、ほかは読む', () => {
    const good = reviewRule(createStudyState(), scheduler, payment, 3, now);
    const { state, dropped } = parseStudyState({
      ...good,
      cards: { ...good.cards, bad: { stability: 'x' }, worse: null },
      logs: [...good.logs, { ruleId: 'pay', at: 'not a date', rating: 3 }, { ruleId: 'pay', at: now.toISOString(), rating: 9 }],
    });
    expect(dropped).toBe(4);
    expect(Object.keys(state.cards)).toEqual(['pay']);
    expect(state.logs).toHaveLength(1);
  });

  it('知らない版や JSON でないものは、空から始める', () => {
    expect(parseStudyState({ version: 99 }).state).toEqual(createStudyState());
    const store = createMemoryStore();
    store.setItem(STUDY_KEY, '{');
    expect(loadStudyState(store)).toEqual({ state: createStudyState(), dropped: 1 });
    expect(loadStudyState(createMemoryStore())).toEqual({ state: createStudyState(), dropped: 0 });
  });

  it('選べない設定値は既定に戻す', () => {
    const { state } = parseStudyState({ ...createStudyState(), desiredRetention: 0.5, newPerDay: 7 });
    expect(state.desiredRetention).toBe(0.9);
    expect(state.newPerDay).toBe(10);
  });

  it('記録は上限で古いものから捨てる', () => {
    let state = createStudyState();
    state.logs = Array.from({ length: STUDY_LOG_LIMIT }, () => ({ ruleId: 'pay', at: now.toISOString(), rating: 3 as const, wasNew: false, retrievability: null }));
    state = reviewRule(state, scheduler, payment, 4, now);
    expect(state.logs).toHaveLength(STUDY_LOG_LIMIT);
    expect(state.logs.at(-1)?.rating).toBe(4);
  });

  it('消したルールのカードと記録を外す', () => {
    let state = reviewRule(createStudyState(), scheduler, payment, 3, now);
    state = reviewRule(state, scheduler, closing, 3, now);
    const pruned = pruneStudyState(state, [closing]);
    expect(Object.keys(pruned.cards)).toEqual(['close']);
    expect(pruned.logs.map((log) => log.ruleId)).toEqual(['close']);
    // 何も変わらなければ同じものを返す。
    expect(pruneStudyState(pruned, [closing])).toBe(pruned);
  });
});

describe('日の境目は日本時間', () => {
  it('今日の終わりは日本時間 23:59:59.999', async () => {
    const { endOfDayTokyo } = await import('../src/core/study');
    expect(endOfDayTokyo('2026-11-26').toISOString()).toBe('2026-11-26T14:59:59.999Z');
  });
});

describe('バックアップ', () => {
  it('学習の記録があれば書き出しに含め、無ければ省く', async () => {
    const { buildExportFile, createDefaultState } = await import('../src/core/storage');
    const state = reviewRule(createStudyState(), scheduler, payment, 3, now);
    expect(buildExportFile(createDefaultState(), now, state).study).toEqual(state);
    expect(buildExportFile(createDefaultState(), now, createStudyState())).not.toHaveProperty('study');
  });

  it('取り込むときは、カードは新しく評価したほうを残し、記録は重ねずに合わせる', async () => {
    const { mergeStudyStates, studyFromBackup } = await import('../src/core/studyData');
    const older = reviewRule(createStudyState(), scheduler, payment, 3, new Date('2026-11-01T00:00:00.000Z'));
    const newer = reviewRule(older, scheduler, payment, 4, now);
    const merged = mergeStudyStates(older, newer);
    expect(merged.cards['pay']).toEqual(newer.cards['pay']);
    expect(merged.logs.map((log) => log.rating)).toEqual([3, 4]);
    // 逆向きに合わせても、新しいほうが残る。
    expect(mergeStudyStates(newer, older).cards['pay']).toEqual(newer.cards['pay']);
    expect(studyFromBackup({ rules: [] })).toBeNull();
    expect(studyFromBackup({ study: newer })).toEqual(newer);
  });
});

describe('出題はランダム', () => {
  it('shuffle は並びを入れ替えるだけ（同じ要素がそろう）', async () => {
    const { shuffle } = await import('../src/core/study');
    const items = ['a', 'b', 'c', 'd'];
    expect(shuffle(items, () => 0.999)).toEqual(items);
    const mixed = shuffle(items, () => 0);
    expect(mixed).not.toEqual(items);
    expect([...mixed].sort()).toEqual(items);
    // 元の配列は変えない。
    expect(items).toEqual(['a', 'b', 'c', 'd']);
  });

  it('乱数を渡すと、並びも新しいものの選び方もばらばらにする', () => {
    const many = Array.from({ length: 6 }, (_, index) => makeRule({ id: `r${index}`, title: `ルール${index}` }));
    const state = { ...createStudyState(), newPerDay: 3 };
    const progress = progressOf(many, state, scheduler, now, today);
    expect(buildQueue(progress, state, today).map((item) => item.rule.id)).toEqual(['r0', 'r1', 'r2']);
    const picked = buildQueue(progress, state, today, () => 0).map((item) => item.rule.id);
    expect(picked).toHaveLength(3);
    expect(picked).not.toEqual(['r0', 'r1', 'r2']);
  });
});

describe('週の予定の問題（分単位の学習ステップ）', () => {
  let short: Scheduler;
  beforeAll(async () => {
    const { createShortTermScheduler } = await import('../src/core/study');
    short = await createShortTermScheduler();
  });
  const thursday = '2026-11-26';
  const at = (iso: string) => new Date(iso);

  it('週は月曜始まり', async () => {
    const { weekRange } = await import('../src/core/study');
    expect(weekRange('this', thursday)).toEqual({ start: '2026-11-23', end: '2026-11-29' });
    expect(weekRange('last', thursday)).toEqual({ start: '2026-11-16', end: '2026-11-22' });
    expect(weekRange('next', thursday)).toEqual({ start: '2026-11-30', end: '2026-12-06' });
  });

  it('1分・10分の学習ステップを踏んでから、日単位の間隔へ移る', async () => {
    const { reviewWeek, weekProgressOf, previewNextWeek } = await import('../src/core/study');
    let state = createStudyState();
    let clock = at('2026-11-26T01:00:00.000Z');
    expect(previewNextWeek(short, state, 'this', clock, thursday)).toMatchObject({ 1: '1分後', 3: '10分後' });

    state = reviewWeek(state, short, 'this', 3, clock, thursday);
    let item = weekProgressOf(state, short, clock, thursday).find((week) => week.key === 'this')!;
    expect(item.status).toBe('learning');
    expect((item.dueAt!.getTime() - clock.getTime()) / 60_000).toBe(10);

    clock = item.dueAt!;
    state = reviewWeek(state, short, 'this', 1, clock, thursday);
    item = weekProgressOf(state, short, clock, thursday).find((week) => week.key === 'this')!;
    expect((item.dueAt!.getTime() - clock.getTime()) / 60_000).toBe(1);

    clock = item.dueAt!;
    state = reviewWeek(state, short, 'this', 3, clock, thursday);
    clock = weekProgressOf(state, short, clock, thursday).find((week) => week.key === 'this')!.dueAt!;
    state = reviewWeek(state, short, 'this', 3, clock, thursday);
    item = weekProgressOf(state, short, clock, thursday).find((week) => week.key === 'this')!;
    expect(item.status).toBe('review');
    expect(item.dueAt!.getTime() - clock.getTime()).toBeGreaterThanOrEqual(86_400_000);
  });

  it('週が替わると、新しい週の問題として覚え直す', async () => {
    const { reviewWeek, weekProgressOf } = await import('../src/core/study');
    let state = reviewWeek(createStudyState(), short, 'this', 4, at('2026-11-26T01:00:00.000Z'), thursday);
    const nextMonday = '2026-11-30';
    const later = at('2026-11-30T01:00:00.000Z');
    const item = weekProgressOf(state, short, later, nextMonday).find((week) => week.key === 'this')!;
    expect(item).toMatchObject({ status: 'new', card: null, start: '2026-11-30' });
    state = reviewWeek(state, short, 'this', 3, later, nextMonday);
    expect(state.cards['week:this']).toMatchObject({ reps: 1, ruleRev: 'week:2026-11-30' });
  });

  it('今の復習に入れるのは、まだ覚えていない週と1時間以内に出すものだけ', async () => {
    const { reviewWeek, weekProgressOf, weekQueue } = await import('../src/core/study');
    const clock = at('2026-11-26T01:00:00.000Z');
    let state = reviewWeek(createStudyState(), short, 'last', 3, clock, thursday); // 10分後
    state = reviewWeek(state, short, 'next', 4, clock, thursday); // 日単位
    const queue = weekQueue(weekProgressOf(state, short, clock, thursday), clock).map((item) => item.key);
    expect(queue).toEqual(['last', 'this']);
  });

  it('週の予定の問題の記録は、ルールを消しても残す', () => {
    const state = { ...createStudyState(), cards: { 'week:this': reviewRule(createStudyState(), scheduler, payment, 3, now).cards['pay']! } };
    expect(Object.keys(pruneStudyState(state, []).cards)).toEqual(['week:this']);
  });

  it('週の予定の問題は止められる（設定は保存される）', () => {
    expect(createStudyState().weekCards).toBe(true);
    expect(parseStudyState({ ...createStudyState(), weekCards: false }).state.weekCards).toBe(false);
  });

  it('その週の予定を日ごとにまとめる（一時停止中は入れない）', async () => {
    const { weekOccurrences } = await import('../src/core/study');
    const days = weekOccurrences([payment, paused], scheduleContext, { start: '2026-12-21', end: '2026-12-27' });
    expect(days.map((day) => day.date)).toEqual(['2026-12-25']);
    expect(days[0]?.items.map((item) => item.rule.id)).toEqual(['pay']);
  });
});

describe('describeDueAt', () => {
  it('今日のうちは分・時間で、明日以降は日で言う', async () => {
    const { describeDueAt } = await import('../src/core/study');
    const base = new Date('2026-11-26T01:00:00.000Z'); // 日本時間 10:00
    const later = (minutes: number) => new Date(base.getTime() + minutes * 60_000);
    expect(describeDueAt(base, later(0.2), '2026-11-26')).toBe('今すぐ');
    expect(describeDueAt(base, later(10), '2026-11-26')).toBe('10分後');
    expect(describeDueAt(base, later(180), '2026-11-26')).toBe('約3時間後');
    expect(describeDueAt(base, later(24 * 60), '2026-11-26')).toBe('明日');
  });
});
