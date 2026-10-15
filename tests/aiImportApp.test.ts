/**
 * @vitest-environment jsdom
 *
 * AI の回答の取り込みと保存（docs/SPEC.md §9.5）。
 *
 * 登録を押すまで保存しない。読み込めなかったときは何も保存しない。
 * 既にあるルール・カレンダー・表示設定には触れない。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { ruleSnapshot } from '../src/core/aiContext';
import { AI_IMPORT_FORMAT } from '../src/core/aiImport';
import { STORAGE_KEYS } from '../src/core/storage';
import { holidays, makeRule } from './helpers';

const reply = (rules: unknown[]): string =>
  `\`\`\`json\n${JSON.stringify({ format: AI_IMPORT_FORMAT, schemaVersion: 1, rules })}\n\`\`\``;

const payment = {
  title: '支払',
  calendarId: 'bank',
  recurrence: { type: 'monthlyByDay', days: [25] },
  adjust: { mode: 'prev' },
};

const click = (text: string): void => {
  const target = [...document.querySelectorAll('button')].find((node) => node.textContent === text);
  if (target === undefined) throw new Error(`ボタンが見つかりません: ${text}`);
  target.dispatchEvent(new MouseEvent('click'));
};

function paste(text: string): void {
  const input = document.querySelector<HTMLTextAreaElement>('.ai-import-input');
  if (input === null) throw new Error('貼り付け欄が見つかりません');
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

const savedRules = (): { id: string; title: string }[] =>
  JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.rules) ?? '[]');

let root: HTMLElement;

beforeEach(() => {
  globalThis.localStorage.clear();
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function openWithExisting(): App {
  const existing = [makeRule({ id: 'keep', title: '既存の給与振込' })];
  globalThis.localStorage.setItem(STORAGE_KEYS.rules, JSON.stringify(existing));
  const app = new App(root, holidays);
  app.render();
  // ヘッダーの〈ルール〉→〈AIで作る〉。
  click('ルール');
  click('AIで作る');
  return app;
}

describe('AI の回答の取り込み（アプリ全体）', () => {
  it('空の画面からも開ける', () => {
    const app = new App(root, holidays);
    app.render();
    click('AIで作る');
    expect(document.querySelector('.ai-import')).not.toBeNull();
  });

  it('登録すると既存のルールを残したまま後ろへ足し、保存する', () => {
    openWithExisting();
    const calendarsBefore = globalThis.localStorage.getItem(STORAGE_KEYS.calendars);
    const prefsBefore = globalThis.localStorage.getItem(STORAGE_KEYS.prefs);
    const keepBefore = JSON.stringify(savedRules()[0]);

    paste(reply([payment]));
    click('内容を確認');
    // 確認画面の段階では保存しない。
    expect(savedRules().map((rule) => rule.title)).toEqual(['既存の給与振込']);

    click('この内容で登録');
    expect(savedRules().map((rule) => rule.title)).toEqual(['既存の給与振込', '支払']);
    // 既存のルールは1文字も変わらない。カレンダーと表示設定にも触れない。
    expect(JSON.stringify(savedRules()[0])).toBe(keepBefore);
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.calendars)).toBe(calendarsBefore);
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.prefs)).toBe(prefsBefore);
    expect(document.body.textContent).toContain('「支払」を登録しました。');
    expect(document.querySelector('.ai-import')).toBeNull();
  });

  it('読み込めなかったときは何も保存しない', () => {
    openWithExisting();
    const before = globalThis.localStorage.getItem(STORAGE_KEYS.rules);
    paste(reply([{ ...payment, adjust: { mode: 'previousBusinessDay' } }]));
    click('内容を確認');
    expect(document.querySelector('.ai-errors')).not.toBeNull();
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.rules)).toBe(before);
  });

  it('登録前にキャンセルすれば保存しない', () => {
    openWithExisting();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const before = globalThis.localStorage.getItem(STORAGE_KEYS.rules);
    paste(reply([payment]));
    click('内容を確認');
    click('キャンセル');
    expect(document.querySelector('.ai-import')).toBeNull();
    expect(globalThis.localStorage.getItem(STORAGE_KEYS.rules)).toBe(before);
  });

  it('貼り付けたまま閉じようとしたら確かめ、取り消せば残る', () => {
    openWithExisting();
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    paste(reply([payment]));
    click('閉じる');
    expect(confirm).toHaveBeenCalledWith('貼り付けた内容はまだ登録されていません。閉じますか？');
    expect(document.querySelector('.ai-import')).not.toBeNull();
    expect(document.querySelector<HTMLTextAreaElement>('.ai-import-input')?.value).toContain('支払');
  });

  it('何も貼っていなければ確かめずに閉じる', () => {
    openWithExisting();
    const confirm = vi.spyOn(globalThis, 'confirm');
    click('閉じる');
    expect(confirm).not.toHaveBeenCalled();
    expect(document.querySelector('.ai-import')).toBeNull();
  });

  it('確認画面のあいだに描き直しが起きても、内容を失わない', () => {
    const app = openWithExisting();
    paste(reply([payment]));
    click('内容を確認');
    app.render();
    expect(document.querySelector('.ai-review')).not.toBeNull();
  });

  it('別のタブが増やしたルールも消さない', () => {
    openWithExisting();
    paste(reply([payment]));
    click('内容を確認');
    // 確認しているあいだに、別のタブがルールを足した。
    const other = [...savedRules(), makeRule({ id: 'other-tab', title: '別タブで追加' })];
    globalThis.localStorage.setItem(STORAGE_KEYS.rules, JSON.stringify(other));
    click('この内容で登録');
    expect(savedRules().map((rule) => rule.title)).toEqual(['既存の給与振込', '別タブで追加', '支払']);
  });

  it('直す指示を反映すると、その予定だけを置き換えて保存する', () => {
    const existing = [
      makeRule({ id: 'keep', title: '既存の給与振込' }),
      makeRule({ id: 'pay', title: '支払', note: '取引先A社', recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' }, adjust: { mode: 'prev', keepInMonth: false } }),
    ];
    globalThis.localStorage.setItem(STORAGE_KEYS.rules, JSON.stringify(existing));
    const app = new App(root, holidays);
    app.render();
    click('ルール');
    click('AIで作る');
    const keepBefore = JSON.stringify(savedRules()[0]);

    paste(reply([{ ...ruleSnapshot(existing[1]!, false), title: '支払（本社）' }, payment]));
    click('内容を確認');
    click('この内容で反映（追加 1 件・変更 1 件）');

    const after = savedRules() as unknown as { id: string; title: string; note?: string }[];
    expect(after.map((rule) => rule.title)).toEqual(['既存の給与振込', '支払（本社）', '支払']);
    expect(after[1]).toMatchObject({ id: 'pay', note: '取引先A社' });
    expect(JSON.stringify(after[0])).toBe(keepBefore);
    expect(document.body.textContent).toContain('1 件を追加、1 件を変更しました。');
  });

  it('確認のあいだに別のタブで消された予定は、作り直さずに知らせる', () => {
    const target = makeRule({ id: 'pay', title: '支払' });
    globalThis.localStorage.setItem(STORAGE_KEYS.rules, JSON.stringify([target]));
    const app = new App(root, holidays);
    app.render();
    click('ルール');
    click('AIで作る');
    paste(reply([{ ...ruleSnapshot(target, false), title: '支払（本社）' }]));
    click('内容を確認');
    globalThis.localStorage.setItem(STORAGE_KEYS.rules, '[]');
    click('この内容で反映（変更 1 件）');
    expect(savedRules()).toEqual([]);
    expect(document.body.textContent).toContain('「支払」は別の画面で削除されていたため、変更していません。');
  });
});
