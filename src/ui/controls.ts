/**
 * ルール編集フォームで使う小さな入力部品。
 * 状態は持たず、値と変更ハンドラを受け取って要素を返すだけにする。
 */

import { h } from './dom';

/** ラベルと説明を付けたフィールドの枠。 */
export function field(labelText: string, control: HTMLElement, hint?: string): HTMLElement {
  return h(
    'div',
    { class: 'field' },
    h('span', { class: 'field-label' }, labelText),
    control,
    hint === undefined ? null : h('p', { class: 'field-hint' }, hint),
  );
}

export type ToggleOption<T> = {
  value: T;
  label: string;
  /** 押されていない状態でも意味を持たせたいときの補助クラス。 */
  className?: string;
};

/**
 * 複数選択のトグルボタン群。チェックボックスより一覧性が高く、
 * 「毎月10日と25日」のような複数指定を1画面で扱える。
 */
export function toggleGroup<T extends string | number>(
  options: readonly ToggleOption<T>[],
  selected: readonly T[],
  onChange: (next: T[]) => void,
  extraClass = '',
): HTMLElement {
  const current = new Set<T>(selected);
  const group = h('div', { class: `toggles ${extraClass}`.trim(), role: 'group' });

  for (const option of options) {
    const button = h(
      'button',
      {
        type: 'button',
        class: `toggle ${option.className ?? ''}`.trim(),
        'aria-pressed': current.has(option.value) ? 'true' : 'false',
      },
      option.label,
    );
    button.addEventListener('click', () => {
      if (current.has(option.value)) current.delete(option.value);
      else current.add(option.value);
      button.setAttribute('aria-pressed', current.has(option.value) ? 'true' : 'false');
      // 元の options の並びを保って返す。表示順と保存順を一致させるため。
      onChange(options.filter((item) => current.has(item.value)).map((item) => item.value));
    });
    group.append(button);
  }
  return group;
}

/** 単一選択のセレクトボックス。 */
export function select<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
  onChange: (next: T) => void,
): HTMLSelectElement {
  const element = h('select', { class: 'select' });
  for (const option of options) {
    const node = h('option', { value: option.value }, option.label);
    if (option.value === value) node.selected = true;
    element.append(node);
  }
  element.addEventListener('change', () => onChange(element.value as T));
  return element;
}

export function numberInput(
  value: number,
  onChange: (next: number) => void,
  attributes: { min?: number; max?: number; class?: string } = {},
): HTMLInputElement {
  const input = h('input', {
    type: 'number',
    class: attributes.class ?? 'input input-num',
    value: String(value),
    min: attributes.min,
    max: attributes.max,
  });
  input.addEventListener('input', () => {
    const parsed = Number(input.value);
    if (Number.isFinite(parsed)) onChange(parsed);
  });
  return input;
}

export function textInput(
  value: string,
  onChange: (next: string) => void,
  placeholder = '',
): HTMLInputElement {
  const input = h('input', { type: 'text', class: 'input', value, placeholder });
  input.addEventListener('input', () => onChange(input.value));
  return input;
}

export function dateInput(
  value: string | null,
  onChange: (next: string | null) => void,
): HTMLInputElement {
  const input = h('input', { type: 'date', class: 'input', value: value ?? '' });
  input.addEventListener('change', () => onChange(input.value === '' ? null : input.value));
  return input;
}

export function checkbox(
  labelText: string,
  checked: boolean,
  onChange: (next: boolean) => void,
): HTMLLabelElement {
  const input = h('input', { type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'checkbox' }, input, h('span', {}, labelText));
}

export function button(
  labelText: string,
  onClick: () => void,
  className = 'button',
): HTMLButtonElement {
  const element = h('button', { type: 'button', class: className }, labelText);
  element.addEventListener('click', onClick);
  return element;
}
