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
  onDuplicate: vi.fn(),
  onToggle: vi.fn(),
  onOpenSettings: vi.fn(),
  onRenameGroup: vi.fn(),
  onDeleteGroup: vi.fn(),
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

describe('グループの一括操作', () => {
  const rules = [
    makeRule({ id: 'a', title: '源泉所得税', group: '税務' }),
    makeRule({ id: 'b', title: '住民税', group: '税務' }),
    makeRule({ id: 'c', title: 'なんとなくの予定' }),
  ];

  /** 一括操作は1か所にまとめて畳んである。 */
  const actionRow = (root: HTMLElement, name: string): Element | undefined =>
    [...root.querySelectorAll('.group-action-row')].find(
      (node) => node.querySelector('.group-action-name')?.textContent === name,
    );

  const clickIn = (root: ParentNode, text: string): void => {
    const target = [...root.querySelectorAll('button')].find((n) => n.textContent === text);
    if (target === undefined) throw new Error(`ボタンが見つかりません: ${text}`);
    target.dispatchEvent(new MouseEvent('click'));
  };

  it('一括操作は1か所にまとめて畳む', () => {
    // 見出しの横に常時置くと、予定を読むだけのときにも目に入り続ける。
    const element = renderRuleList(rules, calendars, handlers);
    const box = element.querySelector<HTMLDetailsElement>('.advanced-options');
    expect(box?.querySelector('summary')?.textContent).toContain('グループ操作');
    expect(box?.open).toBe(false);
    // 見出しの中にはボタンを置かない。
    expect(element.querySelectorAll('.rule-group-title button')).toHaveLength(0);
  });

  it('名前のある束には「名前を変更」と「まとめて削除」を出す', () => {
    const element = renderRuleList(rules, calendars, handlers);
    const labels = [...(actionRow(element, '税務')?.querySelectorAll('button') ?? [])].map(
      (n) => n.textContent,
    );
    expect(labels).toEqual(['名前を変更', 'まとめて削除']);
  });

  it('未分類は並べない（名前を持たないため）', () => {
    const element = renderRuleList(rules, calendars, handlers);
    expect(actionRow(element, '未分類')).toBeUndefined();
  });

  it('何件あるかを添える（消す前に分かるように）', () => {
    const element = renderRuleList(rules, calendars, handlers);
    expect(actionRow(element, '税務')?.textContent).toContain('2件');
  });

  it('名前を変更すると、新しい名前を渡す', () => {
    const onRenameGroup = vi.fn();
    vi.spyOn(globalThis, 'prompt').mockReturnValue('税金');
    const element = renderRuleList(rules, calendars, { ...handlers, onRenameGroup });
    clickIn(actionRow(element, '税務') as ParentNode, '名前を変更');
    expect(onRenameGroup).toHaveBeenCalledWith('税務', '税金');
    vi.restoreAllMocks();
  });

  it('取り消したら何もしない', () => {
    const onRenameGroup = vi.fn();
    vi.spyOn(globalThis, 'prompt').mockReturnValue(null);
    const element = renderRuleList(rules, calendars, { ...handlers, onRenameGroup });
    clickIn(actionRow(element, '税務') as ParentNode, '名前を変更');
    expect(onRenameGroup).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('まとめて削除は束の名前を渡す', () => {
    const onDeleteGroup = vi.fn();
    const element = renderRuleList(rules, calendars, { ...handlers, onDeleteGroup });
    clickIn(actionRow(element, '税務') as ParentNode, 'まとめて削除');
    expect(onDeleteGroup).toHaveBeenCalledWith('税務');
  });
});
