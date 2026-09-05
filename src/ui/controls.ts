/**
 * ルール編集フォームで使う小さな入力部品。
 * 状態は持たず、値と変更ハンドラを受け取って要素を返すだけにする。
 */

import { h } from './dom';

let fieldSequence = 0;
/** label/for で名前を付けられる要素。 */
const LABELABLE = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
/**
 * 自前のロールを持つ要素。ここに role="group" をかぶせるとロールが消えるため触らない。
 * （ボタンを field() に渡したとき、実際にボタンとして扱われなくなった。）
 */
const INTERACTIVE = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL']);

/**
 * ラベルと説明を付けたフィールドの枠。
 *
 * 見出しを span で置くだけでは支援技術に「この入力欄の名前」として伝わらず、
 * プレースホルダーが名前として読まれてしまう。単一の入力欄なら label/for で
 * 結び付け、トグル群のような複数要素なら group として aria-labelledby で結ぶ。
 * 説明文は aria-describedby でぶら下げる。
 */
export function field(labelText: string, control: HTMLElement, hint?: string): HTMLElement {
  fieldSequence += 1;
  const labelId = `field-label-${fieldSequence}`;
  const hintId = `field-hint-${fieldSequence}`;

  // 枠自体が入力要素でなければ、中の最初の入力要素を探して結び付ける。
  const target = LABELABLE.has(control.tagName)
    ? control
    : control.querySelector<HTMLElement>('input, select, textarea');

  const describedBy = hint === undefined ? null : hintId;

  let labelElement: HTMLElement;
  if (target !== null && target.closest('.field') === null) {
    // 入力欄が1つに定まる場合は label/for で結ぶ。
    if (target.id === '') target.id = `field-control-${fieldSequence}`;
    labelElement = h('label', { class: 'field-label', id: labelId, for: target.id }, labelText);
    if (describedBy !== null) target.setAttribute('aria-describedby', describedBy);
  } else if (!INTERACTIVE.has(control.tagName)) {
    // トグル群のように入力要素が複数ある場合は、まとまりとして名前を付ける。
    labelElement = h('span', { class: 'field-label', id: labelId }, labelText);
    control.setAttribute('role', control.getAttribute('role') ?? 'group');
    control.setAttribute('aria-labelledby', labelId);
    if (describedBy !== null) control.setAttribute('aria-describedby', describedBy);
  } else {
    // ボタンなど、それ自身が名前とロールを持つ要素。見出しは飾りに留める。
    labelElement = h('span', { class: 'field-label', id: labelId }, labelText);
    if (describedBy !== null) control.setAttribute('aria-describedby', describedBy);
  }

  return h(
    'div',
    { class: 'field' },
    labelElement,
    control,
    hint === undefined ? null : h('p', { class: 'field-hint', id: hintId }, hint),
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

/** 検証結果を入力欄へ反映する。エラーの所在を支援技術にも伝えるため。 */
export function markInvalid(element: HTMLElement, invalid: boolean): void {
  if (invalid) element.setAttribute('aria-invalid', 'true');
  else element.removeAttribute('aria-invalid');
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
