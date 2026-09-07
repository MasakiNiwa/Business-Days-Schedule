/**
 * ルールのグループ（docs/SPEC.md §5.5）。
 */

import { describe, expect, it } from 'vitest';
import {
  UNGROUPED,
  collectGroups,
  filterByGroup,
  groupLabel,
  groupOf,
  hasUngrouped,
  resolveActiveGroup,
} from '../src/core/group';
import { makeRule } from './helpers';

const rules = [
  makeRule({ id: 'a', title: '源泉所得税', group: '税務' }),
  makeRule({ id: 'b', title: '住民税', group: '税務' }),
  makeRule({ id: 'c', title: '入金予定', group: '売上・入金' }),
  makeRule({ id: 'd', title: 'なんとなくの予定' }),
];

describe('groupOf', () => {
  it('未設定と空文字は未分類として同じに扱う', () => {
    expect(groupOf(makeRule({ id: 'x' }))).toBe(UNGROUPED);
    expect(groupOf(makeRule({ id: 'x', group: '' }))).toBe(UNGROUPED);
  });

  it('前後の空白は落とす', () => {
    // 「税務」と「税務 」が別の束になると、絞り込みで片方が消えて混乱する。
    expect(groupOf(makeRule({ id: 'x', group: '  税務 ' }))).toBe('税務');
  });
});

describe('collectGroups', () => {
  it('使われている名前を重複なく名前順で返す', () => {
    const groups = collectGroups(rules);
    expect(new Set(groups)).toEqual(new Set(['税務', '売上・入金']));
    // 日本語の並び順は環境の照合データ次第なので、順序そのものは固定しない。
    // 「毎回同じ順で出る」ことだけを確かめる。
    expect(groups).toEqual([...groups].sort((a, b) => a.localeCompare(b, 'ja')));
  });

  it('未分類は含めない', () => {
    expect(collectGroups(rules)).not.toContain(UNGROUPED);
    expect(collectGroups([makeRule({ id: 'x' })])).toEqual([]);
  });
});

describe('hasUngrouped', () => {
  it('グループの無いルールがあるかを返す', () => {
    expect(hasUngrouped(rules)).toBe(true);
    expect(hasUngrouped(rules.slice(0, 3))).toBe(false);
  });
});

describe('filterByGroup', () => {
  it('null なら絞らない', () => {
    expect(filterByGroup(rules, null)).toHaveLength(4);
  });

  it('名前を指定するとその束だけ返す', () => {
    expect(filterByGroup(rules, '税務').map((rule) => rule.id)).toEqual(['a', 'b']);
  });

  it('未分類だけを取り出せる', () => {
    expect(filterByGroup(rules, UNGROUPED).map((rule) => rule.id)).toEqual(['d']);
  });
});

describe('resolveActiveGroup', () => {
  it('存在する束はそのまま', () => {
    expect(resolveActiveGroup(rules, '税務')).toBe('税務');
  });

  it('消えた束はすべてへ戻す', () => {
    // 名前を変えた・最後の1件を消したときに、何も出ない画面で固まらせない。
    expect(resolveActiveGroup(rules, '存在しない')).toBeNull();
  });

  it('未分類が1件も無くなったらすべてへ戻す', () => {
    expect(resolveActiveGroup(rules, UNGROUPED)).toBe(UNGROUPED);
    expect(resolveActiveGroup(rules.slice(0, 3), UNGROUPED)).toBeNull();
  });

  it('すべては常にすべて', () => {
    expect(resolveActiveGroup([], null)).toBeNull();
  });
});

describe('groupLabel', () => {
  it('未分類には呼び名を与える', () => {
    expect(groupLabel(UNGROUPED)).toBe('未分類');
    expect(groupLabel('税務')).toBe('税務');
  });
});
