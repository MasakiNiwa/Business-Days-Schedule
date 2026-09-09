/**
 * 最小限の DOM 生成ヘルパー。
 * ルール名や備考はユーザー入力なので、innerHTML を使わず textContent 経由で組む。
 */

type Attributes = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') element.className = String(value);
    else if (name === 'text') element.textContent = String(value);
    else if (value === true) element.setAttribute(name, '');
    else element.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

export function clear(element: Element): void {
  element.replaceChildren();
}

/**
 * 見える位置まで運ぶ。jsdom には実装が無いので、無ければ黙って諦める。
 * 画面上の親切なので、無くても機能は損なわれない。
 */
export function scrollIntoView(
  element: Element | null | undefined,
  block: ScrollLogicalPosition = 'start',
): void {
  element?.scrollIntoView?.({ block });
}
