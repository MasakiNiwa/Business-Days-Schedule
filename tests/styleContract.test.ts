/**
 * スタイルシートが満たすべき約束事の検査。
 *
 * ブラウザでしか現れない種類の不具合を、構造として固定しておくための保険。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, '../src/style.css'), 'utf-8');

describe('スタイルの約束事', () => {
  it('[hidden] を強制的に効かせている', () => {
    // ブラウザ標準の [hidden]{display:none} は作者スタイルより弱く、
    // .field{display:flex} などがあると打ち消されてしまう。
    // 条件付きの入力欄（隔週の基準日・2月の扱い・当月内補正）がこれで消えなくなっていた。
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  it('hidden で出し分ける要素が display 指定を持つことを前提にしている', () => {
    // 前提が崩れた（display 指定が無くなった）ら上のルールは不要になるが、
    // 残っていても害はない。ここでは前提が生きていることだけ確認する。
    expect(css).toMatch(/\.field\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.checkbox\s*\{[^}]*display:\s*flex/);
  });
});
