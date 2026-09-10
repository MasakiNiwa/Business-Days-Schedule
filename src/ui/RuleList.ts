/**
 * ルール一覧（docs/SPEC.md §8.1）。
 * M3 から追加・編集・削除・有効/無効の切り替えができる。
 */

import { describePeriod, describeRule, describeTiming } from '../core/describe';
import { timingOf } from '../core/notice';
import { UNGROUPED, groupLabel, groupOf } from '../core/group';
import type { BusinessCalendar, Rule } from '../types';
import { button } from './controls';
import { h } from './dom';

export type RuleListHandlers = {
  onLoadSamples: () => void;
  onAdd: () => void;
  onEdit: (ruleId: string) => void;
  /** 似た設定を作るとき、一から組み直さずに済むようにする。 */
  onDuplicate: (ruleId: string) => void;
  onToggle: (ruleId: string, enabled: boolean) => void;
  onOpenSettings: () => void;
  /** グループ名をまとめて付け替える。1件ずつ編集させると取りこぼすため。 */
  onRenameGroup: (group: string, next: string) => void;
  /** グループごとまとめて消す。 */
  onDeleteGroup: (group: string) => void;
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
  const group = groupOf(rule);
  if (group !== UNGROUPED) meta.push(h('span', { class: 'rule-group-tag' }, group));
  for (const notice of rule.notices) {
    meta.push(
      h('span', { class: 'rule-notice' }, `${describeTiming(timingOf(notice))}: ${notice.label}`),
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
      // 触る画面では title が出ないため、何のつまみなのかを文字でも出す。
      h(
        'label',
        { class: 'switch' },
        toggle,
        // 無効のときに出る「無効」バッジと同じ言葉にそろえる。
        h('span', { class: 'switch-text' }, '有効'),
      ),
      button('編集', () => handlers.onEdit(rule.id), 'button button-sm button-quiet'),
      button('複製', () => handlers.onDuplicate(rule.id), 'button button-sm button-quiet'),
    ),
  );
}

/**
 * グループごとの一括操作。
 *
 * 見出しの横に常時置くと、予定を読むだけのときにも目に入り続ける。
 * たまにしか使わないので、まとめて畳んでおく。
 */
function renderGroupActions(
  names: readonly string[],
  buckets: ReadonlyMap<string, Rule[]>,
  handlers: RuleListHandlers,
): HTMLElement {
  const rows = h('ul', { class: 'group-actions' });
  for (const name of names) {
    const count = buckets.get(name)?.length ?? 0;
    rows.append(
      h(
        'li',
        { class: 'group-action-row' },
        h('span', { class: 'group-action-name' }, name),
        h('span', { class: 'rule-group-count' }, `${count}件`),
        button(
          '名前を変更',
          () => {
            const next = globalThis.prompt(
              `「${name}」の新しい名前を入力してください。\n空にすると未分類へ移します。`,
              name,
            );
            if (next === null) return;
            handlers.onRenameGroup(name, next);
          },
          'button button-sm button-quiet',
        ),
        button('まとめて削除', () => handlers.onDeleteGroup(name), 'button button-sm button-quiet'),
      ),
    );
  }

  return h(
    'details',
    { class: 'advanced-options' },
    h('summary', {}, 'グループ操作（名前の変更・まとめて削除）'),
    h(
      'p',
      { class: 'field-hint' },
      '名前を変えると、その束のルールをまとめて付け替えます。' +
        '削除は何件消えるかを確かめてから実行します（元に戻せません）。',
    ),
    rows,
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
        h('p', {}, 'まだルールがありません。まずは1件、作ってみてください。'),
        h(
          'p',
          { class: 'empty-hint' },
          '給与振込・支払・締め日・会議のひな型から選べます。' +
            '実務でよく使う予定をまとめて見たいときは「完成例を見る」から。',
        ),
        h(
          'div',
          { class: 'empty-prompt-actions' },
          button('最初のルールを作る', () => handlers.onAdd(), 'button button-primary'),
          button('完成例を見る', () => handlers.onLoadSamples()),
        ),
      ),
      h(
        'div',
        { class: 'editor-actions' },
        button('閉じる', () => handlers.onClose(), 'button button-primary'),
      ),
    );
    return section;
  }

  // グループを使い始めたら見出しで束ねる。1つも無いうちは、見出しだけの
  // 「未分類」が出ても意味が無いので、素の一覧のままにする。
  const buckets = new Map<string, Rule[]>();
  for (const rule of rules) {
    const group = groupOf(rule);
    const bucket = buckets.get(group);
    if (bucket === undefined) buckets.set(group, [rule]);
    else bucket.push(rule);
  }
  const grouped = [...buckets.keys()].some((group) => group !== UNGROUPED);

  if (!grouped) {
    // グループを使っていない人には、絞り込み欄そのものが画面に出ない。
    // 機能があること自体に気づけないので、ここで一度だけ知らせる。
    section.append(
      h(
        'div',
        { class: 'callout callout-info' },
        h('p', { class: 'callout-title' }, 'グループで束ねられます'),
        h(
          'p',
          {},
          '「編集」を押して〈グループ〉に「税務」「入金」などと入れると、カレンダーの上に絞り込みが出ます。その束だけを表示したり、束ごとに外部カレンダーへ書き出したりできます。',
        ),
      ),
      h('ul', { class: 'rules' }, ...rules.map((rule) => renderRule(rule, calendars, handlers))),
    );
  } else {
    // 未分類は最後に置く。名前の付いた束のほうが探す対象になりやすい。
    const names = [...buckets.keys()]
      .filter((group) => group !== UNGROUPED)
      .sort((a, b) => a.localeCompare(b, 'ja'));
    if (buckets.has(UNGROUPED)) names.push(UNGROUPED);

    for (const name of names) {
      const items = buckets.get(name) ?? [];
      section.append(
        h(
          'div',
          { class: 'rule-group' },
          h(
            'h3',
            { class: 'rule-group-title' },
            groupLabel(name),
            h('span', { class: 'rule-group-count' }, `${items.length}件`),
          ),
          h('ul', { class: 'rules' }, ...items.map((rule) => renderRule(rule, calendars, handlers))),
        ),
      );
    }

    // 束の操作は1か所にまとめて畳む。見出しごとにボタンを常時並べると、
    // 予定を読むだけのときに目に入り続けて邪魔になる。
    const named = names.filter((name) => name !== UNGROUPED);
    if (named.length > 0) {
      section.append(renderGroupActions(named, buckets, handlers));
    }
  }

  section.append(
    h(
      'div',
      { class: 'editor-actions' },
      button('閉じる', () => handlers.onClose(), 'button button-primary'),
    ),
  );
  return section;
}
