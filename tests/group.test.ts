/**
 * ルールのグループ（docs/SPEC.md §5.5）。
 */

import { describe, expect, it } from 'vitest';
import {
  UNGROUPED,
  collectGroups,
  filterByGroups,
  groupLabel,
  groupOf,
  hasUngrouped,
  resolveActiveGroups,
  renameGroup,
  rulesInGroup,
  groupsLabel,
  GROUP_NAME_MAX,
} from '../src/core/group';
import { LIMITS } from '../src/core/validate';
import type { Rule } from '../src/types';
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

describe('filterByGroups', () => {
  it('null なら絞らない', () => {
    expect(filterByGroups(rules, null)).toHaveLength(4);
  });

  it('名前を指定するとその束だけ返す', () => {
    expect(filterByGroups(rules, ['税務']).map((rule: Rule) => rule.id)).toEqual(['a', 'b']);
  });

  it('未分類だけを取り出せる', () => {
    expect(filterByGroups(rules, [UNGROUPED]).map((rule: Rule) => rule.id)).toEqual(['d']);
  });

  it('複数の束をまとめて取り出せる', () => {
    // 「税務と入金だけ見比べたい」のたびに選び直させないため。
    expect(filterByGroups(rules, ['税務', '売上・入金']).map((rule: Rule) => rule.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('resolveActiveGroups', () => {
  it('存在する束はそのまま', () => {
    expect(resolveActiveGroups(rules, ['税務'])).toEqual(['税務']);
  });

  it('消えた束だけを落とす', () => {
    expect(resolveActiveGroups(rules, ['税務', '存在しない'])).toEqual(['税務']);
  });

  it('全部消えたらすべてへ戻す', () => {
    // 名前を変えた・最後の1件を消したときに、何も出ない画面で固まらせない。
    expect(resolveActiveGroups(rules, ['存在しない'])).toBeNull();
  });

  it('未分類が1件も無くなったらすべてへ戻す', () => {
    expect(resolveActiveGroups(rules, [UNGROUPED])).toEqual([UNGROUPED]);
    expect(resolveActiveGroups(rules.slice(0, 3), [UNGROUPED])).toBeNull();
  });

  it('すべては常にすべて', () => {
    expect(resolveActiveGroups([], null)).toBeNull();
  });
});

describe('renameGroup', () => {
  /** 成功した前提で書き換え後のルールを取り出す。 */
  const renamed = (from: string, to: string): Rule[] => {
    const result = renameGroup(rules, from, to);
    if (!result.ok) throw new Error(`弾かれました: ${result.reason}`);
    return result.rules;
  };

  it('その名前を持つルールをまとめて付け替える', () => {
    // 1件ずつ編集させると取りこぼす。
    expect(renamed('税務', '税金').filter((rule) => rule.group === '税金').map((rule) => rule.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('他の束は触らない', () => {
    expect(renamed('税務', '税金').find((rule) => rule.id === 'c')?.group).toBe('売上・入金');
  });

  it('空にすると未分類へ移す', () => {
    expect(renamed('税務', '').filter((rule) => groupOf(rule) === UNGROUPED)).toHaveLength(3);
  });

  it('前後の空白は落とす', () => {
    expect(renamed('税務', '  税金  ')[0]?.group).toBe('税金');
  });

  it('上限ちょうどは通す', () => {
    const name = 'あ'.repeat(GROUP_NAME_MAX);
    expect(renamed('税務', name)[0]?.group).toBe(name);
  });

  it('上限を超えたら1件も書き換えない', () => {
    // 読み込み側は上限を超えるグループ名のルールを捨てる。検証せずに保存すると、
    // その束のルールが再読込で丸ごと消える。
    const result = renameGroup(rules, '税務', 'あ'.repeat(GROUP_NAME_MAX + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(`${GROUP_NAME_MAX} 文字`);
  });

  it('弾いたときは元のルールをそのまま残す', () => {
    // 一部だけ変えると、同じ束が2つの名前に割れる。
    const result = renameGroup(rules, '税務', 'あ'.repeat(GROUP_NAME_MAX + 1));
    expect(result.ok).toBe(false);
    expect(rules.filter((rule) => groupOf(rule) === '税務')).toHaveLength(2);
  });
});

describe('rulesInGroup', () => {
  it('まとめて消す対象を数えられる', () => {
    expect(rulesInGroup(rules, '税務')).toHaveLength(2);
    expect(rulesInGroup(rules, '存在しない')).toHaveLength(0);
  });
});

describe('groupsLabel', () => {
  it('すべてなら名前を持たない', () => {
    expect(groupsLabel(null)).toBeNull();
    expect(groupsLabel([])).toBeNull();
  });

  it('1つならその名前', () => {
    expect(groupsLabel(['税務'])).toBe('税務');
  });

  it('複数なら並べる（何を渡したのか後から分かるように）', () => {
    expect(groupsLabel(['税務', '売上'])).toBe('税務・売上');
  });

  it('未分類も呼び名で出す', () => {
    expect(groupsLabel([UNGROUPED])).toBe('未分類');
  });
});

describe('groupLabel', () => {
  it('未分類には呼び名を与える', () => {
    expect(groupLabel(UNGROUPED)).toBe('未分類');
    expect(groupLabel('税務')).toBe('税務');
  });
});

describe('グループ名の上限', () => {
  it('読み込み側の検証と必ず揃える', () => {
    // ここがずれると、保存はできるのに再読込で消える名前ができてしまう。
    expect(GROUP_NAME_MAX).toBe(LIMITS.groupLength);
  });
});
