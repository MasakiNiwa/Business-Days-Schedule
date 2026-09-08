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
    expect(text).toContain('破線の枠');
  });

  it('このアプリにしかない考え方を説明する', () => {
    // 営業日補正・決算月基準・グループ・前後の予定は、ほかのカレンダーに
    // 無い概念なので、画面だけでは伝わらない。ヘルプが唯一の説明になる。
    const text = renderHelp(() => undefined).textContent ?? '';
    for (const term of [
      '決算月から逆算する',
      '前後の予定（準備日・フォロー）',
      'グループで束ねる',
      '外部カレンダーへ書き出す',
      '思ったとおりに出ないとき',
    ]) {
      expect(text, term).toContain(term);
    }
  });

  it('はじめの手順と、つまずいたときの答えを載せる', () => {
    const element = renderHelp(() => undefined);
    expect(element.querySelectorAll('.help-steps li').length).toBeGreaterThanOrEqual(3);
    const text = element.textContent ?? '';
    expect(text).toContain('追加したはずの予定が見えない');
    expect(text).toContain('決算月を変えたのに日付が動かない');
  });

  it('節ごとに目次から飛べる', () => {
    // 1画面に収まらない長さなので、頭から読ませるのではなく行き先を出す。
    const element = renderHelp(() => undefined);
    const links = [...element.querySelectorAll<HTMLAnchorElement>('.help-toc-link')];
    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const link of links) {
      const id = link.getAttribute('href')?.slice(1) ?? '';
      expect(element.querySelector(`#${id}`), id).not.toBeNull();
    }
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
