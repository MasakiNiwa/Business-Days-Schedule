import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

/**
 * 版と作成時刻をビルド時に埋め込む。
 * 静的サイトは「いま見ているものがいつのものか」が分かりにくく、
 * 不具合の報告を受けたときに版を突き合わせられないと原因を追えないため。
 */
const buildInfo = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  // GitHub Actions では実際のコミットが入る。手元では unknown。
  __APP_COMMIT__: JSON.stringify((process.env['GITHUB_SHA'] ?? 'local').slice(0, 7)),
};

// GitHub Pages はリポジトリ名のサブパス配下で配信されるため base を固定する。
// ローカル開発 (vite dev) では '/' で動かしたいので command で切り替える。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Business-Days-Schedule/' : '/',
  define: buildInfo,
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
}));
