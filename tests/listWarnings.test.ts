/**
 * @vitest-environment jsdom
 *
 * 一覧の警告（docs/SPEC.md §8.3）。
 *
 * 一覧の予定は起点からの期間で計算しているのに、警告だけはカレンダーが
 * 止まっている月から取っていた。11月を一覧で見ていても9月の話が並び、
 * 11月に起きることは出ない。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { DEFAULT_PREFERENCES, savePreferences, saveRules } from '../src/core/storage';
import { holidays, makeRule } from './helpers';

/** 第22営業日が無い月がある。その月にだけ「日付を決められない」警告が出る。 */
const monthlyClose = makeRule({
  id: 'close',
  title: '月次締め',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
  notices: [
    {
      id: 'n1',
      label: '確定処理',
      timing: { kind: 'monthlyBusinessDay', months: 0, nth: 22 },
      role: 'after',
    },
  ],
});

function openList(): { root: HTMLElement; app: App } {
  saveRules(globalThis.localStorage, [monthlyClose]);
  savePreferences(globalThis.localStorage, {
    ...DEFAULT_PREFERENCES,
    defaultView: 'list',
    listDays: 30,
  });
  const root = document.createElement('div');
  document.body.append(root);
  const app = new App(root, holidays);
  app.render();
  return { root, app };
}

const banners = (root: HTMLElement): string =>
  [...root.querySelectorAll('.banner')].map((node) => node.textContent ?? '').join('\n');

const setStart = (root: HTMLElement, date: string): void => {
  const input = root.querySelector<HTMLInputElement>('[aria-label="一覧の起点"]');
  if (input === null) throw new Error('一覧の起点の欄が見つかりません');
  input.value = date;
  input.dispatchEvent(new Event('change'));
};

beforeEach(() => {
  vi.useFakeTimers();
  // 2026-09-15（JST）。カレンダーは9月を指したままにしておく。
  vi.setSystemTime(new Date('2026-09-15T03:00:00Z'));
  globalThis.localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('一覧の警告は、一覧で見ている期間のもの', () => {
  it('起点を動かす前は、今日からの期間の警告が出る', () => {
    const { root } = openList();
    expect(banners(root)).toContain('2026-09-10');
  });

  it('起点を先の月へ動かすと、その期間の警告に入れ替わる', () => {
    const { root } = openList();
    setStart(root, '2026-11-01');
    const shown = banners(root);
    // カレンダーは9月のままだが、一覧が見ているのは11月。
    expect(shown).toContain('2026-11-10');
    expect(shown).not.toContain('2026-09-10');
  });

  it('その期間に何も起きなければ、警告は出ない', () => {
    const { root } = openList();
    // 2026-07 は第22営業日がある月。起点をそこへ移すと、この警告は消える。
    setStart(root, '2026-07-01');
    expect(banners(root)).not.toContain('確定処理');
  });
});
