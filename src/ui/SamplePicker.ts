/**
 * サンプルの追加（docs/SPEC.md §9.3）。
 *
 * 空の状態からの導入だけでなく、使い始めたあとでも種類を足せるようにする。
 *
 * 既定は「無いものだけ足す」。同じ ID のルールを黙って上書きすると、
 * 利用者が編集した名前や日付が予告なく元へ戻ってしまうため。
 * 元へ戻したいときだけ、件数を示したうえで明示的に選ばせる。
 */

import type { SamplePack } from '../core/samples';
import { button, checkbox } from './controls';
import type { Rule } from '../types';
import { describeRule } from '../core/describe';
import { h } from './dom';

export type SamplePickerHandlers = {
  onAdd: (pack: SamplePack) => void;
  onRestore: (pack: SamplePack) => void;
  onClose: () => void;
  onLoadRules?: (pack: SamplePack) => Promise<readonly Rule[]>;
  onAddSelected?: (pack: SamplePack, ids: string[]) => void;
};

export function renderSamplePicker(
  packs: readonly SamplePack[],
  addedIds: ReadonlySet<string>,
  handlers: SamplePickerHandlers,
  error: string | null = null,
): HTMLElement {
  const section = h(
    'section',
    { class: 'samples', 'aria-label': 'サンプルの追加' },
    h('h2', { class: 'editor-title' }, 'サンプルを追加'),
    h(
      'p',
      { class: 'field-hint' },
      '実務でよく使う型をまとめてあります。追加したあとは自由に編集・削除できます。日付や名称はあくまで目安なので、自社の運用に合わせて直してください。',
    ),
    h(
      'p',
      { class: 'field-hint' },
      '追加しても既にあるルールは変更しません。編集した内容が消えることはありません。',
    ),
  );

  if (error !== null) {
    section.append(h('p', { class: 'issue issue-error' }, error));
    section.append(
      h('div', { class: 'editor-actions' }, button('閉じる', () => handlers.onClose(), 'button')),
    );
    return section;
  }

  const list = h('ul', { class: 'sample-list' });
  for (const pack of packs) {
    const added = addedIds.has(pack.id);
    const actions = h(
      'div',
      { class: 'sample-actions' },
      button('追加', () => handlers.onAdd(pack), 'button button-sm button-primary'),
      added
        ? button('元に戻す', () => handlers.onRestore(pack), 'button button-sm button-quiet')
        : null,
    );

    const choices = h('div', { class: 'sample-choices', hidden: true });
    if (handlers.onLoadRules && handlers.onAddSelected) {
      const loadRules = handlers.onLoadRules;
      const addSelected = handlers.onAddSelected;
      const browse = button('内容を選ぶ', () => {
        browse.disabled = true;
        choices.hidden = false;
        choices.textContent = '読み込み中…';
        void loadRules(pack).then((rules) => {
          choices.replaceChildren();
          const selected = new Set<string>();
          const add = button('選んだ予定を追加', () => addSelected(pack, [...selected]), 'button button-sm button-primary');
          add.disabled = true;
          for (const rule of rules) {
            choices.append(checkbox(`${rule.title} — ${describeRule(rule)}`, false, (checked) => {
              if (checked) selected.add(rule.id); else selected.delete(rule.id);
              add.disabled = selected.size === 0;
              add.textContent = `選んだ ${selected.size} 件を追加`;
            }));
          }
          choices.append(add);
        }).catch(() => {
          choices.textContent = '内容を取得できませんでした。もう一度お試しください。';
          browse.disabled = false;
        });
      }, 'button button-sm');
      actions.prepend(browse);
    }

    list.append(
      h(
        'li',
        { class: 'sample-item' },
        h(
          'div',
          { class: 'sample-body' },
          h(
            'p',
            { class: 'sample-name' },
            pack.name,
            h('span', { class: 'sample-count' }, `${pack.count} 件`),
            added ? h('span', { class: 'rule-badge' }, '追加済み') : null,
          ),
          h('p', { class: 'sample-desc' }, pack.description),
          added
            ? h(
                'p',
                { class: 'sample-desc' },
                '「元に戻す」を選ぶと、この束のルールを編集前の内容へ上書きします。',
              )
            : null,
        ),
        actions,
        choices,
      ),
    );
  }
  section.append(list);

  section.append(
    h(
      'div',
      { class: 'editor-actions' },
      button('閉じる', () => handlers.onClose(), 'button button-primary'),
    ),
  );
  return section;
}
