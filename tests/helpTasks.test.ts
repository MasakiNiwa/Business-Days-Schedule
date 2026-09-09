/**
 * @vitest-environment jsdom
 *
 * ヘルプの「やりたいことから探す」（docs/SPEC.md §8.6）。
 *
 * 節見出しは覚えたあとなら探せるが、初めての人は自分の業務をどの項目に
 * 置き換えればよいかから悩む。やりたいことの言葉のまま並べ、
 * 開けば答えが出て、そのまま始められるようにする。
 */

import { describe, expect, it, vi } from 'vitest';
import { renderHelp } from '../src/ui/HelpView';
import type { HelpAction } from '../src/ui/HelpView';

function open(onAction?: (action: HelpAction) => void): HTMLElement {
  return renderHelp({ onClose: vi.fn(), ...(onAction === undefined ? {} : { onAction }) });
}

const tasks = (root: HTMLElement): HTMLDetailsElement[] => [
  ...root.querySelectorAll<HTMLDetailsElement>('.help-task'),
];

const clickIn = (root: ParentNode, text: string): void => {
  const target = [...root.querySelectorAll('button')].find((node) => node.textContent === text);
  if (target === undefined) throw new Error(`ボタンが見つかりません: ${text}`);
  target.dispatchEvent(new MouseEvent('click'));
};

describe('やりたいことから探す', () => {
  it('項目一覧より前に置く', () => {
    // 初めての人が最初に目にするのは、こちらであってほしい。
    const root = open();
    const headings = [...root.querySelectorAll('.help-heading')].map((n) => n.textContent);
    expect(headings[0]).toBe('やりたいことから探す');
    expect(headings).toContain('項目から探す');
  });

  it('実務の言葉で並べる', () => {
    const goals = tasks(open()).map((node) => node.querySelector('summary')?.textContent ?? '');
    expect(goals).toEqual(
      expect.arrayContaining([
        '毎月25日の給与振込を作りたい。25日が休みなら前営業日にしたい',
        '毎月第5営業日に請求書を出したい',
        '作った予定を Outlook / Google カレンダーで見たい',
      ]),
    );
  });

  it('既定ではすべて畳んでおく', () => {
    // 開いた状態で並べると縦に長くなりすぎて、探すのがかえって大変になる。
    expect(tasks(open()).every((node) => !node.open)).toBe(true);
  });

  it('開くと手順が出る', () => {
    const first = tasks(open())[0];
    expect(first?.querySelector('.help-task-body p')?.textContent ?? '').toContain('前営業日');
  });

  it('その場から始められる', () => {
    const onAction = vi.fn();
    const root = open(onAction);
    const salary = tasks(root)[0];
    clickIn(salary as ParentNode, 'ルールを作る');
    expect(onAction).toHaveBeenCalledWith('newRule');
  });

  it('詳しく読む先の節が実在する', () => {
    // 飛び先が無いと、押しても何も起きない。
    const root = open();
    for (const task of tasks(root)) {
      clickIn(task as ParentNode, '詳しく読む');
    }
    // scrollIntoView は jsdom に無いので、飛び先の存在で確かめる。
    const ids = new Set([...root.querySelectorAll('[id^="help-"]')].map((n) => n.id));
    expect(ids.has('help-adjust')).toBe(true);
    expect(ids.has('help-notices')).toBe(true);
    expect(ids.has('help-export')).toBe(true);
  });

  it('始める入口が無い項目でも「詳しく読む」は出す', () => {
    const root = open(vi.fn());
    for (const task of tasks(root)) {
      const labels = [...task.querySelectorAll('button')].map((n) => n.textContent);
      expect(labels).toContain('詳しく読む');
    }
  });

  it('操作を受け取れないときは始める入口を出さない', () => {
    // 押しても何も起きないボタンを置かない。
    const root = open();
    for (const task of tasks(root)) {
      const labels = [...task.querySelectorAll('button')].map((n) => n.textContent);
      expect(labels).toEqual(['詳しく読む']);
    }
  });

  it('従来どおり関数ひとつでも開ける', () => {
    const onClose = vi.fn();
    const root = renderHelp(onClose);
    clickIn(root, '閉じる');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
