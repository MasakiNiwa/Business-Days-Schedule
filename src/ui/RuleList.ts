/**
 * ルール一覧（docs/SPEC.md §8.1）。
 * M3 から追加・編集・削除・有効/無効の切り替えができる。
 */

import { describeNotice, describePeriod, describeRule } from '../core/describe';
import type { BusinessCalendar, Rule } from '../types';
import { button } from './controls';
import { h } from './dom';

export type RuleListHandlers = {
  onLoadSamples: () => void;
  onAdd: () => void;
  onEdit: (ruleId: string) => void;
  onToggle: (ruleId: string, enabled: boolean) => void;
  onOpenSettings: () => void;
  onClose: () => void;
};

function renderRule(
  rule: Rule,
  calendars: ReadonlyMap<string, BusinessCalendar>,
  handlers: RuleListHandlers,
): HTMLElement {
  const calendarName = calendars.get(rule.calendarId)?.name ?? `${rule.calendarId}（未定義）`;
  const period = describePeriod(rule.period);

  const meta: HTMLElement[] = [h('span', { class: 'rule-calendar' }, calendarName)];
  for (const notice of rule.notices) {
    meta.push(
      h('span', { class: 'rule-notice' }, `${describeNotice(notice.offset, notice.unit)}: ${notice.label}`),
    );
  }
  if (period !== '') meta.push(h('span', { class: 'rule-period' }, period));
  if (rule.skipDates.length > 0) {
    meta.push(h('span', { class: 'rule-skip' }, `除外 ${rule.skipDates.length} 件`));
  }

  const toggle = h('input', { type: 'checkbox', 'aria-label': `${rule.title} を有効にする` });
  toggle.checked = rule.enabled;
  toggle.addEventListener('change', () => handlers.onToggle(rule.id, toggle.checked));

  return h(
    'li',
    { class: `rule${rule.enabled ? '' : ' is-disabled'}` },
    h('span', { class: `rule-dot color-${rule.color}`, 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'rule-body' },
      h(
        'p',
        { class: 'rule-title' },
        rule.title,
        rule.enabled ? null : h('span', { class: 'rule-badge' }, '無効'),
      ),
      h('p', { class: 'rule-desc' }, describeRule(rule)),
      meta.length === 0 ? null : h('p', { class: 'rule-meta' }, ...meta),
      rule.note === undefined || rule.note === '' ? null : h('p', { class: 'rule-note' }, rule.note),
    ),
    h(
      'div',
      { class: 'rule-actions' },
      h('label', { class: 'switch', title: '有効/無効' }, toggle),
      button('編集', () => handlers.onEdit(rule.id), 'button button-sm button-quiet'),
    ),
  );
}

export function renderRuleList(
  rules: readonly Rule[],
  calendars: ReadonlyMap<string, BusinessCalendar>,
  handlers: RuleListHandlers,
): HTMLElement {
  const section = h('section', { class: 'rule-panel', 'aria-labelledby': 'rules-heading' });

  section.append(
    h(
      'div',
      { class: 'panel-head' },
      h('h2', { class: 'editor-title', id: 'rules-heading' }, 'ルール'),
      h(
        'div',
        { class: 'panel-actions' },
        // ルールが増えたあとでもサンプルを足せるよう、常に置く。
        // 空のときしか出していなかったため、使い始めると到達できなくなっていた。
        button('＋ 新規ルール', () => handlers.onAdd(), 'button button-sm button-primary'),
        button('サンプル', () => handlers.onLoadSamples(), 'button button-sm'),
        button('設定', () => handlers.onOpenSettings(), 'button button-sm button-quiet'),
      ),
    ),
  );

  if (rules.length === 0) {
    section.append(
      h(
        'div',
        { class: 'empty' },
        h('p', {}, 'まだルールがありません。'),
        h('p', { class: 'empty-hint' }, '実務でよく使う型をまとめたサンプルから始められます。'),
        button('サンプルを読み込む', () => handlers.onLoadSamples()),
      ),
      h(
        'div',
        { class: 'editor-actions' },
        button('閉じる', () => handlers.onClose(), 'button button-primary'),
      ),
    );
    return section;
  }

  section.append(
    h('ul', { class: 'rules' }, ...rules.map((rule) => renderRule(rule, calendars, handlers))),
    h(
      'div',
      { class: 'editor-actions' },
      button('閉じる', () => handlers.onClose(), 'button button-primary'),
    ),
  );
  return section;
}
