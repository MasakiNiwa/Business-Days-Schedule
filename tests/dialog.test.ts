/**
 * @vitest-environment jsdom
 *
 * モーダルの土台。jsdom は <dialog> の showModal/close を実装していないため、
 * 属性でのフォールバックが働くことも含めて固定する。
 */

import { describe, expect, it, vi } from 'vitest';
import { createDialog } from '../src/ui/dialog';
import { h } from '../src/ui/dom';

const content = (): HTMLElement => h('p', {}, '中身');

describe('createDialog', () => {
  it('文書へ挿し込んでから開く（showModal は接続済みでないと使えない）', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const { element } = createDialog(content(), vi.fn(), 'md', mount);
    expect(element.parentElement).toBe(mount);
    mount.remove();
  });

  it('中身と閉じるボタンを持つ dialog を作る', () => {
    const { element } = createDialog(content(), vi.fn());
    expect(element.tagName).toBe('DIALOG');
    expect(element.querySelector('.modal-body')?.textContent).toBe('中身');
    expect(element.querySelector('.modal-close')?.getAttribute('aria-label')).toBe('閉じる');
  });

  it('サイズをクラスで表す', () => {
    expect(createDialog(content(), vi.fn()).element.className).toContain('modal-md');
    expect(createDialog(content(), vi.fn(), 'lg').element.className).toContain('modal-lg');
  });

  it('閉じるボタンで onClose が呼ばれる', () => {
    const onClose = vi.fn();
    const { element } = createDialog(content(), onClose);
    element.querySelector<HTMLButtonElement>('.modal-close')?.dispatchEvent(new MouseEvent('click'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('背景クリックで閉じ、中身のクリックでは閉じない', () => {
    const onClose = vi.fn();
    const { element } = createDialog(content(), onClose);

    element.querySelector('.modal-body')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    element.dispatchEvent(new MouseEvent('click'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('setContent で中身だけ差し替えられる', () => {
    const { element, setContent } = createDialog(content(), vi.fn());
    setContent(h('p', {}, '差し替え後'));
    expect(element.querySelector('.modal-body')?.textContent).toBe('差し替え後');
  });

  it('close() を呼べる', () => {
    const onClose = vi.fn();
    const { close } = createDialog(content(), onClose);
    close();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
