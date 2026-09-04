/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { applyTheme, nextTheme, themeIcon, themeLabel } from '../src/ui/theme';
import { renderHelp } from '../src/ui/HelpView';

describe('applyTheme', () => {
  it('明示指定は data-theme を立て、自動は外す', () => {
    const root = document.createElement('html');
    applyTheme('dark', root);
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyTheme('light', root);
    expect(root.getAttribute('data-theme')).toBe('light');
    applyTheme('auto', root);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});

describe('nextTheme', () => {
  it('自動 → ライト → ダーク → 自動 と巡回する', () => {
    expect(nextTheme('auto')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('auto');
  });

  it('ラベルとアイコンを引ける', () => {
    expect(themeLabel('dark')).toBe('ダーク');
    expect(themeIcon('light')).toBe('☀');
  });
});

describe('renderHelp', () => {
  it('補正の種類をすべて説明する', () => {
    const text = renderHelp(() => undefined).textContent ?? '';
    for (const term of ['前営業日へ', '翌営業日へ', '前後の営業日の両方', '近い方の営業日へ', '補正しない']) {
      expect(text, term).toContain(term);
    }
  });

  it('カレンダーの記号を説明する', () => {
    const text = renderHelp(() => undefined).textContent ?? '';
    expect(text).toContain('←10');
    expect(text).toContain('→10');
    expect(text).toContain('＋N件');
  });

  it('閉じるを呼べる', () => {
    let closed = false;
    const element = renderHelp(() => {
      closed = true;
    });
    [...element.querySelectorAll('button')]
      .find((b) => b.textContent === '閉じる')
      ?.dispatchEvent(new MouseEvent('click'));
    expect(closed).toBe(true);
  });
});
