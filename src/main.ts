import './style.css';
import { startApp } from './app';
import { registerServiceWorker } from './ui/serviceWorker';
import { showUpdateBanner } from './ui/updateBanner';

const root = document.querySelector<HTMLElement>('#app');
if (root !== null) {
  void startApp(root);
}

// 開発中はキャッシュが邪魔になるので、本番ビルドのときだけ登録する。
if (import.meta.env.PROD) {
  registerServiceWorker({ onUpdateAvailable: (prompt) => showUpdateBanner(prompt) });
}
