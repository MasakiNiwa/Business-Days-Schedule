/**
 * 画面の切り替え（docs/SPEC.md §8.1）。
 *
 * 機能を足すたびにヘッダーへボタンを並べてきた結果、どこに何があるかが
 * 初見で分からなくなっていた。行き先を4つに絞り、常に同じ場所に出す。
 *
 * 同じ要素を、広い画面ではヘッダーの中のタブ、狭い画面では画面下に固定した
 * タブとして見せる（出し分けは CSS）。親指で届く位置に置くため。
 */

import { h } from './dom';

export type Page = 'schedule' | 'rules' | 'export' | 'settings';

export const PAGES: readonly { page: Page; label: string; icon: string }[] = [
  // 線だけの簡素な形。色や塗りで主張させない。
  { page: 'schedule', label: '予定', icon: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4' },
  { page: 'rules', label: 'ルール', icon: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01' },
  { page: 'export', label: '書き出し', icon: 'M12 15V3M7 8l5-5 5 5M4 15v5h16v-5' },
  {
    page: 'settings',
    label: '設定',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  },
];

const SVG = 'http://www.w3.org/2000/svg';

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'nav-icon');
  const shape = document.createElementNS(SVG, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

export function renderNavBar(current: Page, onNavigate: (page: Page) => void): HTMLElement {
  const nav = h('nav', { class: 'app-nav', 'aria-label': '画面の切り替え' });
  for (const item of PAGES) {
    const link = h(
      'button',
      { type: 'button', class: 'app-nav-item', 'data-page': item.page },
      icon(item.icon),
      h('span', { class: 'app-nav-label' }, item.label),
    );
    if (item.page === current) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', () => onNavigate(item.page));
    nav.append(link);
  }
  return nav;
}
