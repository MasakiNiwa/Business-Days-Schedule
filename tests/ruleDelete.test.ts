/**
 * @vitest-environment jsdom
 *
 * ルール一覧から直接消す（docs/SPEC.md §8.1）。
 *
 * 狭い画面では行を左へ払うと削除ボタンが出る。消したあとは確認を重ねず、
 * その場に〈元に戻す〉を出す。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { STORAGE_KEYS } from '../src/core/storage';
import { renderRuleList } from '../src/ui/RuleList';
import type { RuleListHandlers } from '../src/ui/RuleList';
import { bankCalendarDef, companyCalendarDef, holidays, makeRule } from './helpers';

type Point = { x: number; y: number };

/** jsdom には TouchEvent が無いので、必要な形だけ持つイベントを組み立てる。 */
function touchEvent(type: string, point: Point): Event {
  const event = new Event(type, { bubbles: true });
  const list = [{ clientX: point.x, clientY: point.y }];
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : list });
  Object.defineProperty(event, 'changedTouches', { value: list });
  return event;
}

function swipe(element: Element, dx: number): void {
  element.dispatchEvent(touchEvent('touchstart', { x: 200, y: 10 }));
  element.dispatchEvent(touchEvent('touchend', { x: 200 + dx, y: 12 }));
}

const calendars = new Map([companyCalendarDef, bankCalendarDef].map((c) => [c.id, c]));
const rules = [makeRule({ id: 'a', title: '給与振込' }), makeRule({ id: 'b', title: '月次締め' })];

function handlers(overrides: Partial<RuleListHandlers> = {}): RuleListHandlers {
  return {
    onLoadSamples: vi.fn(),
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onToggle: vi.fn(),
    onRenameGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('一覧の削除ボタン', () => {
  it('どの行にも、名前の付いた削除ボタンがある', () => {
    const list = renderRuleList(rules, calendars, handlers({ onDelete: vi.fn() }));
    const buttons = [...list.querySelectorAll<HTMLButtonElement>('li.rule .rule-delete')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      '「給与振込」を削除',
      '「月次締め」を削除',
    ]);
  });

  it('押すとそのルールを消す', () => {
    const onDelete = vi.fn();
    const list = renderRuleList(rules, calendars, handlers({ onDelete }));
    list.querySelectorAll<HTMLButtonElement>('.rule-delete')[1]?.click();
    expect(onDelete).toHaveBeenCalledWith('b');
  });

  it('消す手段を渡さなければ出さない', () => {
    const list = renderRuleList(rules, calendars, handlers());
    expect(list.querySelector('.rule-delete')).toBeNull();
  });
});

describe('左へ払って削除ボタンを出す', () => {
  it('左へ払うと開き、右へ払うと閉じる', () => {
    const list = renderRuleList(rules, calendars, handlers({ onDelete: vi.fn() }));
    document.body.append(list);
    const [first] = list.querySelectorAll('li.rule');
    swipe(first!, -100);
    expect(first?.classList.contains('is-revealed')).toBe(true);
    swipe(first!, 100);
    expect(first?.classList.contains('is-revealed')).toBe(false);
  });

  it('開くのは1行だけ', () => {
    const list = renderRuleList(rules, calendars, handlers({ onDelete: vi.fn() }));
    document.body.append(list);
    const [first, second] = list.querySelectorAll('li.rule');
    swipe(first!, -100);
    swipe(second!, -100);
    expect(first?.classList.contains('is-revealed')).toBe(false);
    expect(second?.classList.contains('is-revealed')).toBe(true);
  });

  it('縦のスクロールでは開かない', () => {
    const list = renderRuleList(rules, calendars, handlers({ onDelete: vi.fn() }));
    document.body.append(list);
    const [first] = list.querySelectorAll('li.rule');
    first!.dispatchEvent(touchEvent('touchstart', { x: 200, y: 10 }));
    first!.dispatchEvent(touchEvent('touchend', { x: 130, y: 200 }));
    expect(first?.classList.contains('is-revealed')).toBe(false);
  });

  it('開いた行の編集などを押しても、閉じるだけで動かさない', () => {
    const onEdit = vi.fn();
    const list = renderRuleList(rules, calendars, handlers({ onDelete: vi.fn(), onEdit }));
    document.body.append(list);
    const [first] = list.querySelectorAll('li.rule');
    swipe(first!, -100);
    [...first!.querySelectorAll('button')].find((b) => b.textContent === '編集')?.click();
    expect(onEdit).not.toHaveBeenCalled();
    expect(first?.classList.contains('is-revealed')).toBe(false);
  });
});

describe('アプリ全体: 消して、元に戻す', () => {
  function start(): HTMLElement {
    globalThis.localStorage.setItem(STORAGE_KEYS.rules, JSON.stringify(rules));
    const root = document.createElement('div');
    document.body.append(root);
    new App(root, holidays).render();
    [...root.querySelectorAll<HTMLButtonElement>('.app-nav button')]
      .find((b) => b.textContent === 'ルール')
      ?.click();
    return root;
  }

  const savedTitles = (): string[] =>
    (JSON.parse(globalThis.localStorage.getItem(STORAGE_KEYS.rules) ?? '[]') as { title: string }[]).map(
      (rule) => rule.title,
    );

  it('確認を出さずに消し、〈元に戻す〉で元の位置へ戻す', () => {
    const root = start();
    const confirm = vi.spyOn(globalThis, 'confirm');
    root.querySelector<HTMLButtonElement>('.rule-delete')?.click();

    expect(confirm).not.toHaveBeenCalled();
    expect(savedTitles()).toEqual(['月次締め']);
    const toast = root.querySelector('.banner-toast');
    expect(toast?.textContent).toContain('「給与振込」を削除しました。');
    // 焦点は〈元に戻す〉へ移る。行ごと消えて行き場が無くなるため。
    expect(document.activeElement?.textContent).toBe('元に戻す');

    root.querySelector<HTMLButtonElement>('.banner-action')?.click();
    expect(savedTitles()).toEqual(['給与振込', '月次締め']);
    expect(root.textContent).toContain('「給与振込」を元に戻しました。');
    expect([...root.querySelectorAll('li.rule .rule-title')].map((n) => n.textContent)).toEqual([
      '給与振込',
      '月次締め',
    ]);
  });

  it('別のタブが足したルールは、消すときも戻すときも残す', () => {
    const root = start();
    const other = [...rules, makeRule({ id: 'c', title: '別タブで追加' })];
    globalThis.localStorage.setItem(STORAGE_KEYS.rules, JSON.stringify(other));
    root.querySelector<HTMLButtonElement>('.rule-delete')?.click();
    expect(savedTitles()).toEqual(['月次締め', '別タブで追加']);
    root.querySelector<HTMLButtonElement>('.banner-action')?.click();
    expect(savedTitles()).toEqual(['給与振込', '月次締め', '別タブで追加']);
  });
});
