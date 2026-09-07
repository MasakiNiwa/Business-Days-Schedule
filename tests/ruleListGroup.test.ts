/**
 * @vitest-environment jsdom
 *
 * ルール一覧のグループ表示（docs/SPEC.md §5.5・§8.1）。
 */

import { describe, expect, it, vi } from 'vitest';
import { renderRuleList } from '../src/ui/RuleList';
import type { RuleListHandlers } from '../src/ui/RuleList';
import type { BusinessCalendar, Rule } from '../src/types';
import { companyCalendarDef, makeRule } from './helpers';

const calendars = new Map<string, BusinessCalendar>([[companyCalendarDef.id, companyCalendarDef]]);

const handlers: RuleListHandlers = {
  onLoadSamples: vi.fn(),
  onAdd: vi.fn(),
  onEdit: vi.fn(),
  onToggle: vi.fn(),
  onOpenSettings: vi.fn(),
  onClose: vi.fn(),
};

const render = (rules: Rule[]): HTMLElement => renderRuleList(rules, calendars, handlers);

const groupTitles = (root: ParentNode): string[] =>
  [...root.querySelectorAll('.rule-group-title')].map((node) =>
    (node.firstChild?.textContent ?? '').trim(),
  );

describe('renderRuleList のグループ', () => {
  it('グループが1つも無ければ見出しを出さない', () => {
    // 「未分類」の見出しだけが出ても意味が無い。
    const element = render([makeRule({ id: 'a', title: '定例' })]);
    expect(element.querySelectorAll('.rule-group-title')).toHaveLength(0);
    expect(element.querySelectorAll('.rule')).toHaveLength(1);
  });

  it('グループごとに見出しと件数を出す', () => {
    const element = render([
      makeRule({ id: 'a', title: '源泉所得税', group: '税務' }),
      makeRule({ id: 'b', title: '住民税', group: '税務' }),
      makeRule({ id: 'c', title: '入金', group: '入金' }),
    ]);
    // 日本語の並び順は環境の照合データ次第なので、順序そのものは固定しない。
    expect(new Set(groupTitles(element))).toEqual(new Set(['税務', '入金']));
    const counts = [...element.querySelectorAll('.rule-group-count')].map((n) => n.textContent);
    expect(new Set(counts)).toEqual(new Set(['2件', '1件']));
  });

  it('未分類は最後に置く', () => {
    // 名前の付いた束のほうが探す対象になりやすい。
    const element = render([
      makeRule({ id: 'a', title: 'なんとなく' }),
      makeRule({ id: 'b', title: '源泉所得税', group: '税務' }),
    ]);
    expect(groupTitles(element)).toEqual(['税務', '未分類']);
  });

  it('すべてのルールがどこかの束に入る', () => {
    const rules = [
      makeRule({ id: 'a', title: 'A', group: '税務' }),
      makeRule({ id: 'b', title: 'B' }),
      makeRule({ id: 'c', title: 'C', group: '入金' }),
    ];
    const element = render(rules);
    expect(element.querySelectorAll('.rule')).toHaveLength(rules.length);
  });
});
