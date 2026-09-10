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
  it('タブで引き方を分け、既定は逆引きにする', () => {
    // 索引と解説を1枚に積むと、上から順に読むしかない長さになる。
    // 初めての人が最初に目にするのは、やりたいことの索引であってほしい。
    const root = open();
    const tabs = [...root.querySelectorAll('.help-tab')].map((n) => n.textContent);
    expect(tabs).toEqual(['やりたいことから探す', '項目から探す']);
    expect(root.querySelector('.help-tab[aria-selected="true"]')?.textContent).toBe(
      'やりたいことから探す',
    );
  });

  it('タブを押すと面が入れ替わる', () => {
    const root = open();
    const pane = (id: string): HTMLElement | null => root.querySelector<HTMLElement>(`#${id}`);
    expect(pane('help-pane-tasks')?.hidden).toBe(false);
    expect(pane('help-pane-reading')?.hidden).toBe(true);

    clickIn(root, '項目から探す');
    expect(pane('help-pane-tasks')?.hidden).toBe(true);
    expect(pane('help-pane-reading')?.hidden).toBe(false);
  });

  it('種類でまとめる', () => {
    // 16件を平らに並べると、目で追うだけで疲れる。
    const groups = [...open().querySelectorAll('.help-task-group')].map((n) => n.textContent);
    expect(groups).toEqual([
      '予定を作る',
      '営業日と決算月を設定する',
      '書き出す・見やすくする',
      '困ったとき',
    ]);
  });

  it('日付指定の振込に準備日を付ける項目がある', () => {
    // 実際によくやる設定で、前後の予定の練習にちょうどよい。
    const goals = tasks(open()).map((node) => node.querySelector('summary')?.textContent ?? '');
    expect(goals).toContain('毎月10日の振込に、前日までの準備予定を付けたい');
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
    // 解説はもう一方の面にあるので、そちらへ切り替わる。
    expect(root.querySelector<HTMLElement>('#help-pane-reading')?.hidden).toBe(false);
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

describe('タブのキーボード操作', () => {
  const tabButtons = (root: HTMLElement): HTMLElement[] => [
    ...root.querySelectorAll<HTMLElement>('.help-tab'),
  ];

  const press = (element: HTMLElement, key: string): void => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };

  const selected = (root: HTMLElement): string =>
    root.querySelector('.help-tab[aria-selected="true"]')?.textContent ?? '';

  it('選ばれていないタブは Tab キーの順路から外す', () => {
    const root = open();
    const [first, second] = tabButtons(root);
    expect(first?.getAttribute('tabindex')).toBe('0');
    expect(second?.getAttribute('tabindex')).toBe('-1');
  });

  it('右矢印で次のタブへ移る', () => {
    // Tab キーでは1つぶんしか入らないので、矢印で移れないと
    // キーボードだけでは切り替えられない。
    const root = open();
    document.body.append(root);
    const [first, second] = tabButtons(root);
    first?.focus();
    press(first as HTMLElement, 'ArrowRight');

    expect(selected(root)).toBe('項目から探す');
    expect(document.activeElement).toBe(second);
    root.remove();
  });

  it('左矢印で前のタブへ戻る', () => {
    const root = open();
    document.body.append(root);
    const [first, second] = tabButtons(root);
    second?.focus();
    press(second as HTMLElement, 'ArrowLeft');

    expect(selected(root)).toBe('やりたいことから探す');
    expect(document.activeElement).toBe(first);
    root.remove();
  });

  it('端では回り込む', () => {
    const root = open();
    document.body.append(root);
    const [first] = tabButtons(root);
    first?.focus();
    press(first as HTMLElement, 'ArrowLeft');
    expect(selected(root)).toBe('項目から探す');
    root.remove();
  });

  it('Home と End で両端へ飛ぶ', () => {
    const root = open();
    document.body.append(root);
    const [first, second] = tabButtons(root);
    first?.focus();
    press(first as HTMLElement, 'End');
    expect(selected(root)).toBe('項目から探す');

    press(second as HTMLElement, 'Home');
    expect(selected(root)).toBe('やりたいことから探す');
    root.remove();
  });

  it('関係のないキーには反応しない', () => {
    const root = open();
    const [first] = tabButtons(root);
    press(first as HTMLElement, 'a');
    expect(selected(root)).toBe('やりたいことから探す');
  });
});
