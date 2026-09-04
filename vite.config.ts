import { defineConfig } from 'vite';

// GitHub Pages はリポジトリ名のサブパス配下で配信されるため base を固定する。
// ローカル開発 (vite dev) では '/' で動かしたいので mode で切り替える。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Business-Days-Schedule/' : '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
}));
