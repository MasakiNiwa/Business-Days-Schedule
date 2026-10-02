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
import { attachHorizontalSwipe } from './swipe';

export type RuleListHandlers = {
  onLoadSamples: () => void;
  /** 普段使っている AI に設定を作ってもらう。省略時はボタンを出さない。 */
  onOpenAiImport?: () => void;
  onAdd: () => void;
  onEdit: (ruleId: string) => void;
  /** 似た設定を作るとき、一から組み直さずに済むようにする。 */
  onDuplicate: (ruleId: string) => void;
  onToggle: (ruleId: string, enabled: boolean) => void;
  /**
   * 一覧から直接消す。編集画面を開いてから消すのは手数が多い。
   * 省略時は削除の操作を出さない。
   */
  onDelete?: (ruleId: string) => void;
  /** 省略時はボタンを出さない（画面の切り替えから行けるとき）。 */
  onOpenSettings?: () => void;
  /** グループ名をまとめて付け替える。1件ずつ編集させると取りこぼすため。 */
  onRenameGroup: (group: string, next: string) => void;
  /** グループごとまとめて消す。 */
  onDeleteGroup: (group: string) => void;
  /** 画面として開くときは閉じる操作が要らないので省く。 */
  onClose?: () => void;
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

  const item = h(
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

  const onDelete = handlers.onDelete;
  if (onDelete !== undefined) {
    const remove = button('削除', () => onDelete(rule.id), 'rule-delete');
    remove.setAttribute('aria-label', `「${rule.title}」を削除`);
    item.append(remove);
    attachSwipeToReveal(item);
  }
  return item;
}

/**
 * 狭い画面では、行を左へ払うと削除ボタンが出る（右へ払うと戻る）。
 *
 * 行ごとにボタンを並べると、狭い画面では編集・複製と押し間違えやすい。
 * 払う操作をはさむことで、消すつもりの操作だと分かる。広い画面では
 * ボタンとして常に出ている（CSS で出し分ける）。
 */
function attachSwipeToReveal(item: HTMLElement): void {
  const setRevealed = (revealed: boolean): void => {
    if (revealed) {
      // 開くのは1行だけ。前に開いたものは閉じる。
      for (const other of item.parentElement?.querySelectorAll('.rule.is-revealed') ?? []) {
        if (other !== item) other.classList.remove('is-revealed');
      }
    }
    item.classList.toggle('is-revealed', revealed);
  };
  attachHorizontalSwipe(item, {
    onSwipeLeft: () => setRevealed(true),
    onSwipeRight: () => setRevealed(false),
  });
  // 開いている行の、削除ボタン以外を押したら閉じるだけにする。
  // そのまま編集などが動くと、閉じるつもりの指で別の操作をしてしまう。
  item.addEventListener(
    'click',
    (event) => {
      if (!item.classList.contains('is-revealed')) return;
      if ((event.target as Element | null)?.closest('.rule-delete') !== null) return;
      event.preventDefault();
      event.stopPropagation();
      setRevealed(false);
    },
    { capture: true },
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
      h('h2', { class: 'page-title', id: 'rules-heading' }, 'ルール'),
      h(
        'div',
        { class: 'panel-actions' },
        // ルールが増えたあとでもサンプルを足せるよう、常に置く。
        // 空のときしか出していなかったため、使い始めると到達できなくなっていた。
        button('＋ 新規ルール', () => handlers.onAdd(), 'button button-sm button-primary'),
        handlers.onOpenAiImport === undefined
          ? null
          : button('AIで作る', () => handlers.onOpenAiImport?.(), 'button button-sm button-ai'),
        button('サンプル', () => handlers.onLoadSamples(), 'button button-sm'),
        handlers.onOpenSettings === undefined
          ? null
          : button('設定', () => handlers.onOpenSettings?.(), 'button button-sm button-quiet'),
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
          handlers.onOpenAiImport === undefined
            ? null
            : button('AIで作る', () => handlers.onOpenAiImport?.(), 'button button-ai'),
        ),
      ),
    );
    const close = closeActions(handlers);
    if (close !== null) section.append(close);
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

  const close = closeActions(handlers);
  if (close !== null) section.append(close);
  return section;
}

/** 閉じる操作。画面として開くときは要らないので出さない。 */
function closeActions(handlers: RuleListHandlers): HTMLElement | null {
  const onClose = handlers.onClose;
  if (onClose === undefined) return null;
  return h(
    'div',
    { class: 'editor-actions' },
    button('閉じる', () => onClose(), 'button button-primary'),
  );
}

