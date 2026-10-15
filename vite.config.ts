import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
  /** その版を公開した日。版を上げるときに一緒に書き換える（tests/release.test.ts が確かめる）。 */
  releaseDate?: string;
};

/**
 * 版と作成時刻をビルド時に埋め込む。
 * 静的サイトは「いま見ているものがいつのものか」が分かりにくく、
 * 不具合の報告を受けたときに版を突き合わせられないと原因を追えないため。
 */
const buildInfo = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  // アプリの日付は「版を出した日」にする。ビルド日時は祝日データの週次更新でも
  // 変わるため、それを出すと中身が同じなのに新しい版に見えてしまう。
  __APP_RELEASED_AT__: JSON.stringify(pkg.releaseDate ?? ''),
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
