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
