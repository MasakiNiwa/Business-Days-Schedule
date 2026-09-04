/**
 * ルール一覧（docs/SPEC.md §8.1）。
 * M2 では読み取り専用。追加・編集・削除は M3 で実装する。
 */

import { describeNotice, describePeriod, describeRule } from '../core/describe';
import type { BusinessCalendar, Rule } from '../types';
import { h } from './dom';

function renderRule(rule: Rule, calendars: ReadonlyMap<string, BusinessCalendar>): HTMLElement {
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
  );
}

export type RuleListHandlers = {
  onLoadSamples: () => void;
};

export function renderRuleList(
  rules: readonly Rule[],
  calendars: ReadonlyMap<string, BusinessCalendar>,
  handlers: RuleListHandlers,
): HTMLElement {
  const section = h('section', { class: 'panel', 'aria-labelledby': 'rules-heading' });
  section.append(h('h2', { class: 'panel-title', id: 'rules-heading' }, 'ルール'));

  if (rules.length === 0) {
    const button = h('button', { type: 'button', class: 'button' }, 'サンプルを読み込む');
    button.addEventListener('click', handlers.onLoadSamples);
    section.append(
      h(
        'div',
        { class: 'empty' },
        h('p', {}, 'まだルールがありません。'),
        h('p', { class: 'empty-hint' }, '実務でよく使う8件のサンプルから始められます。'),
        button,
      ),
    );
    return section;
  }

  section.append(
    h('ul', { class: 'rules' }, ...rules.map((rule) => renderRule(rule, calendars))),
  );
  return section;
}
