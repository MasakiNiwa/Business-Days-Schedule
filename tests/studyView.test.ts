/**
 * @vitest-environment jsdom
 *
 * 学習の画面（docs/SPEC.md §8.13）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStore } from '../src/core/storage';
import { createStudyState, loadStudyState, STUDY_KEY } from '../src/core/studyData';
import { StudyView } from '../src/ui/StudyView';
import type { StudyInput } from '../src/ui/StudyView';
import type { Rule } from '../src/types';
import { bankCalendarDef, companyCalendarDef, makeRule, scheduleContext } from './helpers';

const payment = makeRule({
  id: 'pay',
  title: '支払',
  calendarId: 'bank',
  group: '支払・振込',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
  notices: [{ id: 'n0', label: '振込データ作成', timing: { kind: 'offset', offset: -3, unit: 'business' } }],
});
const closing = makeRule({ id: 'close', title: '月次締め', recurrence: { type: 'monthlyByDay', interval: 1, days: ['last'], overflow: 'clamp' } });

const today = '2026-11-26';
let clock = new Date('2026-11-26T01:00:00.000Z');

function input(rules: Rule[] = [payment, closing]): StudyInput {
  return { rules, calendars: [companyCalendarDef, bankCalendarDef], ctx: scheduleContext, today };
}

/** 0.999 を返す乱数だと、並べ替えは元の順のまま・差し込みは末尾になる（テストを読みやすくする）。 */
const keepOrder = () => 0.999;

/** ルールの問題だけを見るときは、週の予定の問題を止めておく。 */
function rulesOnlyStore() {
  const store = createMemoryStore();
  store.setItem(STUDY_KEY, JSON.stringify({ ...createStudyState(), weekCards: false }));
  return store;
}

async function open(rules?: Rule[], store = rulesOnlyStore(), random: () => number = keepOrder) {
  const notify = vi.fn();
  const view = await StudyView.create({ store, now: () => clock, notify, random }, input(rules));
  document.body.replaceChildren(view.element);
  return { view, store, notify, root: view.element };
}

const buttonOf = (root: ParentNode, text: string | RegExp): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((node) =>
    typeof text === 'string' ? node.textContent === text : text.test(node.textContent ?? ''),
  );
  if (found === undefined) throw new Error(`ボタンが見つかりません: ${String(text)}`);
  return found;
};
const click = (root: ParentNode, text: string | RegExp): void => buttonOf(root, text).click();

afterEach(() => {
  clock = new Date('2026-11-26T01:00:00.000Z');
  vi.restoreAllMocks();
});

describe('学習の画面: まとめ', () => {
  it('まだ何も覚えていなければ、新しく覚える数と始めるボタンを出す', async () => {
    const { root } = await open();
    const stats = [...root.querySelectorAll('.study-stat')].map((node) => node.textContent);
    expect(stats[0]).toContain('今日の復習0 件');
    expect(stats[1]).toContain('新しく覚える2 件');
    expect(stats[2]).toContain('覚えたルール0 / 2');
    expect(stats[3]).toContain('—');
    expect(buttonOf(root, '復習を始める（2 件）').disabled).toBe(false);
    // 覚える前は、空のグラフを出さない。
    expect(root.querySelector('.study-forecast-chart')).toBeNull();
  });

  it('ルールが無ければ、登録を案内する', async () => {
    const { root } = await open([]);
    expect(root.querySelector('.study-empty')?.textContent).toContain('ルールを登録すると');
  });
});

describe('学習の画面: 復習', () => {
  it('名前だけを見せ、答えを見てから4段階で評価する', async () => {
    const { root, store } = await open();
    click(root, '復習を始める（2 件）');
    expect(root.querySelector('.study-card-title')?.textContent).toBe('支払');
    expect(root.querySelector('.study-answer')).toBeNull();

    click(root, '答えを見る');
    const answer = root.querySelector('.study-answer');
    expect(answer?.querySelector('.study-answer-desc')?.textContent).toBe('毎月25日 / 休業日なら前営業日');
    expect(answer?.textContent).toContain('3営業日前: 振込データ作成');
    // 日付はアプリの営業日計算で出す。
    expect(answer?.querySelector('.preview-list .preview-date')?.textContent).toBe('2026-12-25');
    expect(answer?.textContent).toContain('前回は 2026-11-25（水）');

    const ratings = [...root.querySelectorAll('.study-rating')].map((node) => node.getAttribute('aria-label'));
    expect(ratings[0]).toBe('もう一度（次の復習は今すぐ）');
    expect(ratings[2]).toMatch(/^できた（次の復習は\d+日後）$/);

    click(root, /^できた/);
    expect(loadStudyState(store).state.cards['pay']?.reps).toBe(1);
    expect(root.querySelector('.study-card-title')?.textContent).toBe('月次締め');
  });

  it('「もう一度」は最後にもう一度出し、全部終わったら知らせる', async () => {
    const { root } = await open();
    click(root, '復習を始める（2 件）');
    click(root, '答えを見る');
    click(root, /^もう一度/);
    expect(root.querySelector('.study-card-count')?.textContent).toBe('残り 2 件');
    click(root, '答えを見る');
    click(root, /^できた/);
    expect(root.querySelector('.study-card-title')?.textContent).toBe('支払');
    click(root, '答えを見る');
    click(root, /^できた/);
    expect(root.querySelector('h2')?.textContent).toBe('今日の復習が終わりました');
    expect(root.textContent).toContain('3 件を復習しました');
    click(root, '学習の画面へ戻る');
    // 同じ日に「もう一度」→「できた」としたカードは、FSRS-7 では今日中にもう一度来ることがある。
    expect(root.querySelector('.study-start')?.textContent).toMatch(/^(今日の復習は終わりました|復習を始める（1 件）)$/);
    expect(root.querySelector('.study-stats')?.textContent).toContain('覚えたルール2 / 2');
    expect(root.querySelector('.study-forecast-chart')).not.toBeNull();
  });

  it('〈終わる〉で途中でもやめられる。評価したぶんは残る', async () => {
    const { root, store } = await open();
    click(root, '復習を始める（2 件）');
    click(root, '答えを見る');
    click(root, /^簡単/);
    click(root, '終わる');
    expect(root.querySelector('.study-stats')).not.toBeNull();
    expect(Object.keys(loadStudyState(store).state.cards)).toEqual(['pay']);
  });
});

describe('学習の画面: ルールごとの定着', () => {
  async function learned() {
    const opened = await open();
    click(opened.root, '復習を始める（2 件）');
    click(opened.root, '答えを見る');
    click(opened.root, /^できた/);
    click(opened.root, '終わる');
    clock = new Date('2026-11-30T01:00:00.000Z');
    opened.view.update(input());
    return opened;
  }

  it('覚えている見込みと次の復習を並べ、開くと忘却曲線と過去の予定を出す', async () => {
    const { root } = await learned();
    const items = [...root.querySelectorAll('.study-rule')];
    // 覚えている見込みの低い順。まだ覚えていないものは後ろ。
    expect(items.map((item) => item.querySelector('.study-rule-name')?.textContent)).toEqual(['支払', '月次締め']);
    const first = items[0] as HTMLDetailsElement;
    expect(first.querySelector('.study-rule-value')?.textContent).toMatch(/^定着 \d+%$/);

    first.open = true;
    first.dispatchEvent(new Event('toggle'));
    const body = first.querySelector('.study-rule-body');
    expect(body?.querySelector('svg.study-curve')?.getAttribute('aria-label')).toMatch(/^忘却曲線。前回の復習から4日で \d+%/);
    expect(body?.querySelector('.study-curve-table')?.textContent).toContain('0日100%');
    const past = [...(body?.querySelectorAll('.study-past li') ?? [])].map((node) => node.textContent);
    expect(past[0]).toBe('2026-11-25（水）');
    expect(past[1]).toBe('2026-10-23（金） ← 本来は 2026-10-25（日）。休業日のため前へ');
    expect(body?.textContent).toContain('最近の評価');
    expect(body?.querySelector('.study-logs')?.textContent).toContain('できた（初めて）');
  });

  it('〈このルールを今すぐ復習〉で、そのルールだけを復習する', async () => {
    const { root } = await learned();
    const first = root.querySelector<HTMLDetailsElement>('.study-rule')!;
    first.open = true;
    first.dispatchEvent(new Event('toggle'));
    click(first, 'このルールを今すぐ復習');
    expect(root.querySelector('.study-card-title')?.textContent).toBe('支払');
    expect(root.querySelector('.study-card-count')?.textContent).toBe('残り 1 件');
  });

  it('ルールを変えたら、復習のときに知らせる', async () => {
    const { root, view } = await learned();
    view.update(input([{ ...payment, recurrence: { ...payment.recurrence, days: [20] } } as Rule, closing]));
    const first = root.querySelector<HTMLDetailsElement>('.study-rule')!;
    first.open = true;
    first.dispatchEvent(new Event('toggle'));
    expect(first.querySelector('.issue-warning')?.textContent).toContain('中身が変わりました');
  });

  it('消したルールの記録は外す', async () => {
    const { view, store } = await learned();
    view.update(input([closing]));
    expect(loadStudyState(store).state.cards).toEqual({});
  });
});

describe('学習の画面: 設定', () => {
  it('目標の定着率と1日の新しいカードの数を保存する', async () => {
    const { root, store } = await open();
    const [retention, perDay] = [...root.querySelectorAll<HTMLSelectElement>('.study-settings select')];
    retention!.value = '0.95';
    retention!.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(loadStudyState(store).state.desiredRetention).toBe(0.95));
    await vi.waitFor(() => expect(root.querySelector('.study-stats')?.textContent).toContain('目標 95%'));
    const perDayNow = root.querySelectorAll<HTMLSelectElement>('.study-settings select')[1]!;
    perDayNow.value = '5';
    perDayNow.dispatchEvent(new Event('change'));
    expect(loadStudyState(store).state.newPerDay).toBe(5);
    expect(perDay).toBeDefined();
  });

  it('記録を消すのは確かめてから', async () => {
    const { root, store } = await open();
    click(root, '復習を始める（2 件）');
    click(root, '答えを見る');
    click(root, /^できた/);
    click(root, '終わる');
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    click(root, '学習の記録を消す');
    expect(Object.keys(loadStudyState(store).state.cards)).toEqual(['pay']);
    click(root, '学習の記録を消す');
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(loadStudyState(store).state).toMatchObject({ cards: {}, logs: [] });
  });

  it('読めなかった記録があれば知らせる', async () => {
    const store = createMemoryStore();
    store.setItem(STUDY_KEY, '{ broken');
    const { notify } = await open(undefined, store);
    expect(notify).toHaveBeenCalledWith('学習の記録のうち、読めなかった 1 件を除きました。', 'error');
  });
});

describe('学習の画面: ランダムな出題', () => {
  it('乱数しだいで出る順番が変わる', async () => {
    const first = async (random: () => number) => {
      const { root } = await open(undefined, rulesOnlyStore(), random);
      click(root, '復習を始める（2 件）');
      return root.querySelector('.study-card-title')?.textContent;
    };
    expect(await first(keepOrder)).toBe('支払');
    expect(await first(() => 0)).toBe('月次締め');
  });
});

describe('学習の画面: 週の予定の問題', () => {
  it('先週・今週・来週の3問を並べ、復習に含める', async () => {
    const { root } = await open(undefined, createMemoryStore());
    const rows = [...root.querySelectorAll('.study-week-row')].map((row) => row.textContent);
    expect(rows[0]).toContain('先週の予定11/16（月）〜11/22（日）');
    expect(rows[1]).toContain('今週の予定11/23（月）〜11/29（日）');
    expect(rows[2]).toContain('来週の予定11/30（月）〜12/6（日）');
    expect(buttonOf(root, '復習を始める（5 件）')).toBeTruthy();
    expect(root.querySelector('.study-stats')?.textContent).toContain('ほかに週の予定 3 問');
  });

  it('答えはアプリが計算したその週の予定。1分・10分で繰り返す', async () => {
    clock = new Date('2026-12-21T01:00:00.000Z'); // 12/21（月）
    const local = { ...input(), today: '2026-12-21' };
    const view = await StudyView.create({ store: createMemoryStore(), now: () => clock, notify: vi.fn(), random: keepOrder }, local);
    document.body.replaceChildren(view.element);
    const root = view.element;
    const thisWeek = [...root.querySelectorAll('.study-week-row')][1]!;
    click(thisWeek, '今すぐ');
    expect(root.querySelector('.study-card-title')?.textContent).toBe('今週の予定');
    expect(root.querySelector('.study-week-range')?.textContent).toBe('12/21（月） 〜 12/27（日）');
    click(root, '答えを見る');
    const answer = root.querySelector('.study-week');
    expect(answer?.textContent).toContain('12/22（火）支払: 振込データ作成');
    expect(answer?.textContent).toContain('12/25（金）支払');
    expect(buttonOf(root, /^できた/).getAttribute('aria-label')).toBe('できた（次の復習は10分後）');

    click(root, /^できた/);
    // 10分たつまで待つ。待たずに続けることもできる。
    expect(root.querySelector('h2')?.textContent).toBe('少し時間をおいて、もう一度');
    expect(root.querySelector('.study-waiting')?.textContent).toContain('次は「今週の予定」です。あと約10分で出します。');
    click(root, '今すぐ出す');
    expect(root.querySelector('.study-card-title')?.textContent).toBe('今週の予定');

    // 時間が来れば、待ちから自動で戻る。
    click(root, '答えを見る');
    click(root, /^もう一度/);
    expect(root.querySelector('.study-waiting')?.textContent).toContain('あと約1分');
    clock = new Date(clock.getTime() + 2 * 60_000);
    view.update(local);
    expect(root.querySelector('.study-card-title')?.textContent).toBe('今週の予定');
  });

  it('設定で止めると、一覧にも復習にも出さない', async () => {
    const { root, store } = await open(undefined, createMemoryStore());
    const toggle = [...root.querySelectorAll<HTMLLabelElement>('.study-settings label.checkbox')].find((label) =>
      label.textContent?.includes('先週・今週・来週'),
    )!.querySelector('input')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(root.querySelector('.study-week-row')).toBeNull();
    expect(buttonOf(root, '復習を始める（2 件）')).toBeTruthy();
    expect(loadStudyState(store).state.weekCards).toBe(false);
  });
});
