/**
 * モーダルダイアログ。
 *
 * <dialog> を使うことで、Esc で閉じる・背面を操作させない・フォーカスを閉じ込める、
 * といった挙動をブラウザに任せられる。狭い画面ではパネルがカレンダーのはるか下に
 * 置かれて見つけにくかったため、副次的な画面はすべてこの上に載せる。
 */

import { h } from './dom';

export type DialogSize = 'md' | 'lg';

export type DialogController = {
  element: HTMLDialogElement;
  /** 中身だけ差し替える。開いたままの更新に使う（フォーカスを失わない）。 */
  setContent: (content: HTMLElement) => void;
  /** 閉じる。確認を通す。`force` を立てると確認せずに閉じる。 */
  close: (force?: boolean) => void;
};

export function createDialog(
  content: HTMLElement,
  onClose: () => void,
  size: DialogSize = 'md',
  mount: HTMLElement = document.body,
  /**
   * 閉じてよいかを尋ねる。false を返すと閉じない。
   *
   * 入力途中で Esc を押す・背景を触るのは起こりやすく、確認なしに閉じると
   * 前後の予定まで組んだ内容が消える。呼び出し側が「変更があるか」を知っている
   * ので、判断はそちらに任せる。
   */
  canClose: () => boolean = () => true,
): DialogController {
  const body = h('div', { class: 'modal-body' }, content);

  const closeButton = h(
    'button',
    { type: 'button', class: 'modal-close', 'aria-label': '閉じる' },
    '×',
  );

  const element = h('dialog', { class: `modal modal-${size}` }, closeButton, body);

  /** 確認を通してから閉じる。強制的に閉じたいときは force を立てる。 */
  const close = (force = false): void => {
    if (!force && !canClose()) return;
    // jsdom など close() を持たない環境でも壊れないようにする。
    if (typeof element.close === 'function') element.close();
    else {
      element.removeAttribute('open');
      onClose();
    }
  };

  closeButton.addEventListener('click', () => close());
  element.addEventListener('close', () => onClose());

  // Esc は close イベントの前に cancel が飛ぶ。ここで止めれば閉じない。
  element.addEventListener('cancel', (event) => {
    if (!canClose()) event.preventDefault();
  });

  // 背景（バックドロップ）のクリックで閉じる。中身の外側かどうかで判定する。
  element.addEventListener('click', (event) => {
    if (event.target === element) close();
  });

  // showModal() は文書に接続済みの要素にしか使えない。先に挿し込んでから開く。
  mount.append(element);
  if (typeof element.showModal === 'function') element.showModal();
  else element.setAttribute('open', '');

  return {
    element,
    setContent: (next) => {
      body.replaceChildren(next);
    },
    close,
  };
}
