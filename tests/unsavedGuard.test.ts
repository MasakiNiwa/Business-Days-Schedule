/**
 * @vitest-environment jsdom
 *
 * 入力途中で閉じたときの確認（docs/SPEC.md §8.4）。
 *
 * Esc・×・背景クリックのどれも起こりやすく、確認なしに閉じると
 * 前後の予定まで組んだ内容が消える。
 */

import { describe, expect, it, vi } from 'vitest';
import { createDialog } from '../src/ui/dialog';
import { RuleEditor } from '../src/ui/RuleEditor';
import { companyCalendarDef, bankCalendarDef, makeRule, scheduleContext } from './helpers';
import { h } from '../src/ui/dom';

const calendars = [companyCalendarDef, bankCalendarDef];

const editorFor = (): RuleEditor =>
  new RuleEditor(
    makeRule({ id: 'r', title: '給与振込' }),
    calendars,
    scheduleContext,
    { onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn() },
    false,
    '2026-09-04',
    [],
  );

const at = (form: HTMLFormElement, label: string): HTMLInputElement | HTMLSelectElement => {
  const node = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
  if (node === null) throw new Error(`欄が見つかりません: ${label}`);
  return node;
};

const clickText = (root: ParentNode, text: string): void => {
  const target = [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  if (target === undefined) throw new Error(`ボタンが見つかりません: ${text}`);
  target.dispatchEvent(new MouseEvent('click'));
};

describe('RuleEditor.isDirty', () => {
  it('開いただけでは変更なし', () => {
    // 読み込みの整え（前後予定の id 付けなど）を変更と見なさない。
    expect(editorFor().isDirty()).toBe(false);
  });

  it('タイトルを打つと変更あり', () => {
    const editor = editorFor();
    const title = editor.element.querySelector<HTMLInputElement>('.input');
    title!.value = '給与振込（改）';
    title!.dispatchEvent(new Event('input'));
    expect(editor.isDirty()).toBe(true);
  });

  it('前後の予定を足しても変更あり', () => {
    const editor = editorFor();
    clickText(editor.element, '＋ 準備日を追加（前）');
    expect(editor.isDirty()).toBe(true);
  });

  it('前後の予定の日数を変えても変更あり', () => {
    const editor = editorFor();
    clickText(editor.element, '＋ 準備日を追加（前）');
    const days = at(editor.element, '1 件目: 本体から何日か');
    days.value = '7';
    days.dispatchEvent(new Event('input'));
    expect(editor.isDirty()).toBe(true);
  });
});

describe('ダイアログの閉じる確認', () => {
  const open = (canClose: () => boolean) => {
    const onClose = vi.fn();
    const dialog = createDialog(h('div', {}, 'x'), onClose, 'md', document.body, canClose);
    return { dialog, onClose };
  };

  it('閉じてよければ閉じる', () => {
    const { dialog, onClose } = open(() => true);
    dialog.close();
    expect(onClose).toHaveBeenCalledOnce();
    dialog.element.remove();
  });

  it('閉じてはいけないなら閉じない', () => {
    const { dialog, onClose } = open(() => false);
    dialog.close();
    expect(onClose).not.toHaveBeenCalled();
    dialog.element.remove();
  });

  it('×ボタンも確認を通す', () => {
    const { dialog, onClose } = open(() => false);
    dialog.element.querySelector<HTMLButtonElement>('.modal-close')?.dispatchEvent(new MouseEvent('click'));
    expect(onClose).not.toHaveBeenCalled();
    dialog.element.remove();
  });

  it('背景クリックも確認を通す', () => {
    const { dialog, onClose } = open(() => false);
    dialog.element.dispatchEvent(new MouseEvent('click'));
    expect(onClose).not.toHaveBeenCalled();
    dialog.element.remove();
  });

  it('Esc も止める（cancel を打ち消す）', () => {
    const { dialog } = open(() => false);
    const event = new Event('cancel', { cancelable: true });
    dialog.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    dialog.element.remove();
  });

  it('閉じてよければ Esc は止めない', () => {
    const { dialog } = open(() => true);
    const event = new Event('cancel', { cancelable: true });
    dialog.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    dialog.element.remove();
  });

  it('force を立てれば確認せずに閉じる', () => {
    // 保存やキャンセルのあと、こちらから閉じるとき用。
    const { dialog, onClose } = open(() => false);
    dialog.close(true);
    expect(onClose).toHaveBeenCalledOnce();
    dialog.element.remove();
  });
});
