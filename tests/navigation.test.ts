/**
 * @vitest-environment jsdom
 *
 * 画面の切り替え（docs/SPEC.md §8.1）。
 *
 * 行き先を〈予定〉〈ルール〉〈書き出し〉〈設定〉の4つに絞り、常に同じ場所に出す。
 * 作業中の入力（編集・AIで作る・サンプルなど）だけをダイアログで重ねる。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { STORAGE_KEYS } from '../src/core/storage';
import { holidays, makeRule } from './helpers';

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

const tab = (label: string): HTMLButtonElement => {
  const target = [...root.querySelectorAll<HTMLButtonElement>('.app-nav button')].find(
    (node) => node.textContent === label,
  );
  if (target === undefined) throw new Error(`タブが見つかりません: ${label}`);
  return target;
};

const click = (text: string): void => {
  const target = [...document.querySelectorAll('button')].find((node) => node.textContent === text);
  if (target === undefined) throw new Error(`ボタンが見つかりません: ${text}`);
  target.dispatchEvent(new MouseEvent('click'));
};

const currentPage = (): string | null => root.querySelector('main')?.getAttribute('data-page') ?? null;

function start(): App {
  globalThis.localStorage.setItem(
    STORAGE_KEYS.rules,
    JSON.stringify([makeRule({ id: 'salary', title: '給与振込' })]),
  );
  const app = new App(root, holidays);
  app.render();
  return app;
}

describe('画面の切り替え', () => {
  it('4つの行き先を並べ、いまの画面に印を付ける', () => {
    start();
    const labels = [...root.querySelectorAll('.app-nav button')].map((node) => node.textContent);
    expect(labels).toEqual(['予定', 'ルール', '書き出し', '設定']);
    expect(root.querySelector('.app-nav [aria-current="page"]')?.textContent).toBe('予定');
    expect(root.querySelector('.app-nav')?.getAttribute('aria-label')).toBe('画面の切り替え');
  });

  it('ルール・書き出し・設定はダイアログではなく画面として開く', () => {
    start();
    for (const [label, page, selector] of [
      ['ルール', 'rules', '.rule-panel'],
      ['書き出し', 'export', '.export'],
      ['設定', 'settings', '.settings'],
    ] as const) {
      tab(label).click();
      expect(currentPage()).toBe(page);
      expect(root.querySelector(`main ${selector}`)).not.toBeNull();
      expect(document.querySelector('dialog')).toBeNull();
      expect(tab(label).getAttribute('aria-current')).toBe('page');
      // 画面には閉じるボタンを置かない（タブで移る）。
      expect([...root.querySelectorAll('main button')].some((b) => b.textContent === '閉じる')).toBe(false);
    }
    tab('予定').click();
    expect(currentPage()).toBe('schedule');
    expect(root.querySelector('.calendar-pane, .list-pane')).not.toBeNull();
  });

  it('月の移動や表示の切り替えは予定の画面にだけ出す', () => {
    start();
    expect(root.querySelector('.month-label')).not.toBeNull();
    tab('ルール').click();
    expect(root.querySelector('.month-label')).toBeNull();
    // 配色と使い方はどの画面でも上端にある。
    expect(root.querySelector('.header-tools [aria-label="使い方・ヘルプ"]')).not.toBeNull();
  });

  it('ルールの画面で編集して保存すると、ルールの画面に戻る', () => {
    start();
    tab('ルール').click();
    click('編集');
    expect(document.querySelector('dialog .rule-editor, dialog form')).not.toBeNull();
    const title = document.querySelector<HTMLInputElement>('dialog .input');
    title!.value = '給与振込（改）';
    title!.dispatchEvent(new Event('input'));
    click('保存');
    expect(currentPage()).toBe('rules');
    expect(root.querySelector('.rule-title')?.textContent).toContain('給与振込（改）');
  });

  it('入力途中のダイアログがあるときは、移る前に確かめる', () => {
    start();
    tab('ルール').click();
    click('編集');
    const title = document.querySelector<HTMLInputElement>('dialog .input');
    title!.value = '書きかけ';
    title!.dispatchEvent(new Event('input'));

    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    tab('設定').click();
    expect(confirm).toHaveBeenCalled();
    // 取り消したので移らない。書きかけも残る。
    expect(currentPage()).toBe('rules');
    expect(document.querySelector<HTMLInputElement>('dialog .input')?.value).toBe('書きかけ');
  });

  it('設定の画面は描き直しても選んでいる分類を保つ', () => {
    const app = start();
    tab('設定').click();
    click('銀行休業日');
    app.render();
    const pressed = root.querySelector('.settings-navigation [aria-pressed="true"]');
    expect(pressed?.textContent).toBe('銀行休業日');
  });

  it('カレンダー上の営業日・決算月の行から設定の画面へ移る', () => {
    start();
    root.querySelector<HTMLButtonElement>('.month-summary')?.click();
    expect(currentPage()).toBe('settings');
  });

  it('ヘルプの「書き出しを開く」から書き出しの画面へ移る', () => {
    start();
    root.querySelector<HTMLButtonElement>('.header-tools [aria-label="使い方・ヘルプ"]')?.click();
    click('書き出しを開く');
    expect(currentPage()).toBe('export');
    expect(document.querySelector('dialog')).toBeNull();
  });
});
