/**
 * 新しい版が用意できたことの案内。
 *
 * 画面の状態を作り直すことになるため、切り替えは利用者の操作を待つ。
 * アプリ本体の再描画に巻き込まれないよう、body 直下に置く。
 */

import type { UpdatePrompt } from './serviceWorker';
import { h } from './dom';

const ID = 'update-banner';

export function showUpdateBanner(prompt: UpdatePrompt): void {
  if (document.getElementById(ID) !== null) return;

  const reload = h('button', { type: 'button', class: 'button button-sm button-primary' }, '再読み込み');
  reload.addEventListener('click', () => prompt.apply());

  const dismiss = h('button', { type: 'button', class: 'button button-sm button-quiet' }, 'あとで');

  const banner = h(
    'div',
    { id: ID, class: 'update-banner', role: 'status', 'aria-live': 'polite' },
    h('span', {}, '新しい版があります。'),
    reload,
    dismiss,
  );
  dismiss.addEventListener('click', () => banner.remove());

  document.body.append(banner);
}
