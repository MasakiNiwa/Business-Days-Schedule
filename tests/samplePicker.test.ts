/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { renderSamplePicker } from '../src/ui/SamplePicker';
import type { SamplePack } from '../src/core/samples';

const packs: SamplePack[] = [
  { id: 'tax', name: '税務・届出', description: '源泉所得税など。', file: 'tax.json', count: 9 },
  { id: 'meetings', name: '会議・報告', description: '週次報告など。', file: 'meetings.json', count: 5 },
];

const clickText = (root: ParentNode, text: string): void => {
  [...root.querySelectorAll('button')]
    .find((b) => b.textContent === text)
    ?.dispatchEvent(new MouseEvent('click'));
};

describe('renderSamplePicker', () => {
  it('束の名前・説明・件数を出す', () => {
    const element = renderSamplePicker(packs, new Set(), { onAdd: vi.fn(), onRestore: vi.fn(), onClose: vi.fn() });
    const items = [...element.querySelectorAll('.sample-item')];
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector('.sample-name')?.textContent).toContain('税務・届出');
    expect(items[0]?.querySelector('.sample-count')?.textContent).toBe('9 件');
    expect(items[0]?.querySelector('.sample-desc')?.textContent).toBe('源泉所得税など。');
  });

  it('追加を呼べる', () => {
    const onAdd = vi.fn();
    const element = renderSamplePicker(packs, new Set(), { onAdd, onRestore: vi.fn(), onClose: vi.fn() });
    element.querySelectorAll('.sample-item')[1]
      ?.querySelector('button')
      ?.dispatchEvent(new MouseEvent('click'));
    expect(onAdd).toHaveBeenCalledWith(packs[1]);
  });

  it('追加済みの束にだけ「元に戻す」を出す', () => {
    const element = renderSamplePicker(packs, new Set(['tax']), {
      onAdd: vi.fn(),
      onRestore: vi.fn(),
      onClose: vi.fn(),
    });
    const [first, second] = [...element.querySelectorAll('.sample-item')];
    expect(first?.querySelector('.rule-badge')?.textContent).toBe('追加済み');
    expect([...(first?.querySelectorAll('.sample-actions button') ?? [])].map((b) => b.textContent))
      .toEqual(['追加', '元に戻す']);
    expect([...(second?.querySelectorAll('.sample-actions button') ?? [])].map((b) => b.textContent))
      .toEqual(['追加']);
  });

  it('「元に戻す」は別のハンドラを呼ぶ（上書きは明示操作にする）', () => {
    const onAdd = vi.fn();
    const onRestore = vi.fn();
    const element = renderSamplePicker(packs, new Set(['tax']), { onAdd, onRestore, onClose: vi.fn() });
    const first = element.querySelector('.sample-item');
    const buttons = [...(first?.querySelectorAll<HTMLButtonElement>('.sample-actions button') ?? [])];
    buttons[1]?.dispatchEvent(new MouseEvent('click'));
    expect(onRestore).toHaveBeenCalledWith(packs[0]);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('既存のルールを変更しないことを伝える', () => {
    const element = renderSamplePicker(packs, new Set(), {
      onAdd: vi.fn(),
      onRestore: vi.fn(),
      onClose: vi.fn(),
    });
    expect(element.textContent).toContain('既にあるルールは変更しません');
  });

  it('編集できることを伝える', () => {
    const element = renderSamplePicker(packs, new Set(), { onAdd: vi.fn(), onRestore: vi.fn(), onClose: vi.fn() });
    expect(element.textContent).toContain('追加したあとは自由に編集・削除できます');
  });

  it('読み込みに失敗したときはエラーだけを出す', () => {
    const element = renderSamplePicker([], new Set(), { onAdd: vi.fn(), onRestore: vi.fn(), onClose: vi.fn() }, '取得できません');
    expect(element.querySelector('.issue-error')?.textContent).toBe('取得できません');
    expect(element.querySelector('.sample-list')).toBeNull();
  });

  it('閉じるを呼べる', () => {
    const onClose = vi.fn();
    const element = renderSamplePicker(packs, new Set(), { onAdd: vi.fn(), onRestore: vi.fn(), onClose });
    clickText(element, '閉じる');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
