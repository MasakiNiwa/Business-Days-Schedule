/**
 * 印刷スタイルの構造検査（docs/SPEC.md §8.9）。
 *
 * 配色トークンのダーク定義は :root より詳細度が高いセレクタに置いてあるため、
 * 印刷時の上書きを素の :root だけに書くと負けてしまい、ダークモードのまま
 * 印刷したときに文字が薄いまま残る。実際に一度その状態になったので、
 * 印刷ブロックがダートと同じセレクタを網羅していることを機械的に確かめる。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** セレクタの直前のコメントを拾わないよう、先に取り除く。 */
const css = readFileSync(resolve(import.meta.dirname, '../src/style.css'), 'utf-8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** `--fg:` を定義しているブロックのセレクタを集める。 */
function selectorsDefiningForeground(source: string): string[] {
  const selectors: string[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let matched: RegExpExecArray | null;
  while ((matched = pattern.exec(source)) !== null) {
    const [, selector, block] = matched;
    if (selector === undefined || block === undefined) continue;
    if (!/--fg\s*:/.test(block)) continue;
    selectors.push(selector.replace(/\s+/g, ' ').trim());
  }
  return selectors;
}

function printBlock(source: string): string {
  const start = source.indexOf('@media print {');
  expect(start).toBeGreaterThan(-1);
  return source.slice(start);
}

describe('印刷スタイル', () => {
  const inPrint = printBlock(css);
  const darkSelectors = selectorsDefiningForeground(css.slice(0, css.indexOf('@media print {')))
    .filter((selector) => selector !== ':root');

  it('ダークのトークン定義が :root 以外のセレクタにも置かれている（前提）', () => {
    expect(darkSelectors.length).toBeGreaterThan(0);
    expect(darkSelectors.join(' ')).toContain("data-theme");
  });

  it('印刷ブロックがダークと同じセレクタをすべて上書きする', () => {
    const printSelectors = selectorsDefiningForeground(inPrint).join(' | ');
    for (const selector of darkSelectors) {
      expect(printSelectors, `印刷側に ${selector} の上書きがない`).toContain(selector);
    }
  });

  it('印刷では白地・黒文字にする', () => {
    expect(inPrint).toMatch(/--fg:\s*#000/);
    expect(inPrint).toMatch(/--bg:\s*#fff/);
    expect(inPrint).toMatch(/background:\s*#fff/);
  });

  it('操作用の要素を印刷しない', () => {
    for (const selector of ['.app-header', '.modal', '.banner', '.legend', '.footer-link']) {
      expect(inPrint, selector).toContain(selector);
    }
  });

  it('紙に残す情報は印刷する', () => {
    // 見出し・営業日数・祝日データの出典。
    expect(inPrint).toContain('.print-title');
    expect(inPrint).toContain('.month-summary');
    expect(inPrint).toContain('.app-footer');
  });

  it('行が用紙をまたいで割れないようにする', () => {
    expect(inPrint).toContain('break-inside: avoid');
  });
});
