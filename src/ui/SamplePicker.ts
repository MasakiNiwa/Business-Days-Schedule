/**
 * サンプルの追加（docs/SPEC.md §9.3）。
 *
 * 空の状態からの導入だけでなく、使い始めたあとでも種類を足せるようにする。
 * 取り込みはマージなので、既にあるルールは消えない。同じ束を再度追加すると、
 * その束のルールだけが元の内容へ戻る。
 */

import type { SamplePack } from '../core/samples';
import { button } from './controls';
import { h } from './dom';

export type SamplePickerHandlers = {
  onAdd: (pack: SamplePack) => void;
  onClose: () => void;
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
    const addButton = button(
      added ? '再追加' : '追加',
      () => handlers.onAdd(pack),
      `button button-sm${added ? ' button-quiet' : ' button-primary'}`,
    );
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
        ),
        addButton,
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
