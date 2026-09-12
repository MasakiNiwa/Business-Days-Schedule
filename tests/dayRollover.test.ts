/**
 * @vitest-environment jsdom
 *
 * 日付をまたいだときの「今日」（docs/SPEC.md §8.2）。
 *
 * 日常的にタブを開いたまま使うので、日付をまたぐことは珍しくない。
 * 起動時に1度だけ求めていたため、23:55 に開いて 00:05 に〈今日〉を押すと
 * 前の日の月へ戻り、今日の強調も前の日のままだった。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { DEFAULT_PREFERENCES, savePreferences, saveRules } from '../src/core/storage';
import { holidays, makeRule } from './helpers';

/** 日本時間 2026-09-30 23:55。 */
const BEFORE_MIDNIGHT = new Date('2026-09-30T14:55:00Z');
/** 日本時間 2026-10-01 00:05。 */
const AFTER_MIDNIGHT = new Date('2026-09-30T15:05:00Z');

function openApp(): { root: HTMLElement; app: App } {
  saveRules(globalThis.localStorage, [makeRule({ id: 'r', title: '月次締め' })]);
  savePreferences(globalThis.localStorage, DEFAULT_PREFERENCES);
  const root = document.createElement('div');
  document.body.append(root);
  const app = new App(root, holidays);
  app.render();
  app.watchDayChange();
  return { root, app };
}

const clickText = (root: ParentNode, text: string): void => {
  const target = [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  if (target === undefined) throw new Error(`ボタンが見つかりません: ${text}`);
  target.dispatchEvent(new MouseEvent('click'));
};

/** 画面の見出しに出ている年月。 */
const shownMonth = (root: HTMLElement): string =>
  root.querySelector('.month-label')?.textContent ?? '';

/** 今日として強調されている日。 */
const markedToday = (root: HTMLElement): string | null =>
  root.querySelector('.is-today [data-date]')?.getAttribute('data-date') ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BEFORE_MIDNIGHT);
  globalThis.localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('開いたまま日付をまたいだとき', () => {
  it('〈今日〉で今日の月へ移る', () => {
    const { root } = openApp();
    expect(shownMonth(root)).toContain('9月');

    // 別の月を見てから日付をまたぐ。
    vi.setSystemTime(AFTER_MIDNIGHT);
    clickText(root, '今日');
    expect(shownMonth(root)).toContain('10月');
  });

  it('今日の強調も新しい日へ移る', () => {
    const { root } = openApp();
    expect(markedToday(root)).toBe('2026-09-30');

    vi.setSystemTime(AFTER_MIDNIGHT);
    clickText(root, '今日');
    expect(markedToday(root)).toBe('2026-10-01');
  });

  it('画面へ戻っただけでも取り直す', () => {
    const { root } = openApp();
    vi.setSystemTime(AFTER_MIDNIGHT);

    // visibilitychange は jsdom では自分で起こす。
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(markedToday(root)).toBe('2026-10-01');
  });

  it('日付が変わっていなければ描き直さない', () => {
    const { root } = openApp();
    const before = root.querySelector('.is-today');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    // 同じ要素のまま（描き直していない）。
    expect(root.querySelector('.is-today')).toBe(before);
  });
});
