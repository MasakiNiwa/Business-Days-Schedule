/**
 * @vitest-environment jsdom
 *
 * 学習の記録をバックアップ（JSON）に含める（docs/SPEC.md §8.13, §9.2）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { STORAGE_KEYS } from '../src/core/storage';
import { createScheduler, createStudyState, reviewRule } from '../src/core/study';
import { loadStudyState, saveStudyState, STUDY_KEY } from '../src/core/studyData';
import { holidays, makeRule } from './helpers';

const salary = makeRule({ id: 'salary', title: '給与振込' });
const other = makeRule({ id: 'other', title: '別の予定' });

type AppInternals = {
  exportJson: () => void;
  importJson: (file: File, mode: 'replace' | 'merge') => Promise<void>;
  clearAll: () => void;
};

let root: HTMLElement;
beforeEach(() => {
  globalThis.localStorage.clear();
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  globalThis.localStorage.setItem(STORAGE_KEYS.rules, JSON.stringify([salary]));
});
afterEach(() => vi.restoreAllMocks());

async function learnedState() {
  const scheduler = await createScheduler();
  return reviewRule(createStudyState(), scheduler, salary, 3, new Date('2026-11-20T01:00:00.000Z'));
}

describe('学習の記録のバックアップ', () => {
  it('エクスポートに学習の記録を含める', async () => {
    const state = await learnedState();
    saveStudyState(globalThis.localStorage, state);
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:test';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const app = new App(root, holidays);
    app.render();
    (app as unknown as AppInternals).exportJson();
    const file = JSON.parse(await blobs[0]!.text()) as { study?: unknown };
    expect(file.study).toEqual(state);
  });

  it('置き換えで読み込むと学習の記録も置き換え、ルールに無いカードは外す', async () => {
    const state = await learnedState();
    const file = new File(
      [JSON.stringify({ schemaVersion: 1, rules: [salary], calendars: [], prefs: {}, study: { ...state, cards: { ...state.cards, ghost: state.cards['salary'] } } })],
      'backup.json',
    );
    const app = new App(root, holidays);
    app.render();
    await (app as unknown as AppInternals).importJson(file, 'replace');
    expect(Object.keys(loadStudyState(globalThis.localStorage).state.cards)).toEqual(['salary']);
  });

  it('追加・上書きで読み込むと、今の記録と合わせる', async () => {
    const scheduler = await createScheduler();
    globalThis.localStorage.setItem(STORAGE_KEYS.rules, JSON.stringify([salary, other]));
    saveStudyState(globalThis.localStorage, reviewRule(createStudyState(), scheduler, other, 3, new Date('2026-11-21T01:00:00.000Z')));
    const file = new File([JSON.stringify({ schemaVersion: 1, rules: [salary], calendars: [], prefs: {}, study: await learnedState() })], 'b.json');
    const app = new App(root, holidays);
    app.render();
    await (app as unknown as AppInternals).importJson(file, 'merge');
    expect(Object.keys(loadStudyState(globalThis.localStorage).state.cards).sort()).toEqual(['other', 'salary']);
  });

  it('すべて削除では、学習の記録も消す', async () => {
    saveStudyState(globalThis.localStorage, await learnedState());
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const app = new App(root, holidays);
    app.render();
    (app as unknown as AppInternals).clearAll();
    expect(globalThis.localStorage.getItem(STUDY_KEY)).toBeNull();
  });
});
