import './style.css';
import { startApp } from './app';

const root = document.querySelector<HTMLElement>('#app');
if (root !== null) {
  void startApp(root);
}
