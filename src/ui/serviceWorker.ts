/**
 * Service Worker の登録と更新の案内（docs/SPEC.md §13）。
 *
 * 静的サイトを一度キャッシュすると、古い版を掴んだまま気づけないのが一番の危険。
 * 新しい版を検知したら、勝手に切り替えず**利用者に知らせて選ばせる**。
 * 編集途中のフォームを黙って作り直してしまわないためでもある。
 */

const SW_URL = `${import.meta.env.BASE_URL}sw.js`;

export type UpdatePrompt = {
  /** 待機中の新しい版へ切り替えて再読み込みする。 */
  apply: () => void;
};

export type ServiceWorkerHandlers = {
  onUpdateAvailable: (prompt: UpdatePrompt) => void;
};

export function registerServiceWorker(handlers: ServiceWorkerHandlers): void {
  if (!('serviceWorker' in navigator)) return;

  // 利用者が「再読み込み」を選んだかどうか。
  // 初回登録でも clients.claim() で controllerchange が飛ぶため、
  // これを見ずに再読み込みすると、初めて開いた人が必ず1回リロードされてしまう。
  let updateAccepted = false;

  void navigator.serviceWorker
    .register(SW_URL)
    .then((registration) => {
      const notify = (worker: ServiceWorker): void => {
        handlers.onUpdateAvailable({
          apply: () => {
            updateAccepted = true;
            worker.postMessage('SKIP_WAITING');
          },
        });
      };

      // 既に新しい版が控えている（前回の訪問で降ってきた）。
      if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
        notify(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (installing === null) return;
        installing.addEventListener('statechange', () => {
          // controller があるということは初回インストールではなく更新。
          if (installing.state === 'installed' && navigator.serviceWorker.controller !== null) {
            notify(installing);
          }
        });
      });
    })
    .catch(() => {
      // 登録できなくてもアプリは通常どおり動く。オフライン対応が付かないだけ。
    });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 初回登録では読み込み直さない。編集中の入力を巻き込まないため。
    if (!updateAccepted || reloading) return;
    reloading = true;
    globalThis.location.reload();
  });
}
