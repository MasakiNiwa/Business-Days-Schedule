/**
 * アプリの名前と版。画面と設定に出し、不具合の報告時に突き合わせられるようにする。
 */

/** 画面・書き出し・文書で共通に使う呼び名。ばらけると同じものに見えなくなる。 */
export const APP_NAME = '営業日スケジュール';

/**
 * 何をするものかを一言で。反復ルールを組み立てるところがこのアプリの役目で、
 * 日々見るのは会社で使っているカレンダーであることが多い。その関係を最初に伝える。
 */
export const APP_TAGLINE = '反復ルールを組んで、Outlook / Google カレンダーへ';

export type BuildInfo = {
  version: string;
  builtAt: string;
  commit: string;
};

export const BUILD_INFO: BuildInfo = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
  builtAt: typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : '',
  commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown',
};

/** 画面に出す短い表記。「v1.0.0」 */
export function shortVersion(info: BuildInfo = BUILD_INFO): string {
  return `v${info.version}`;
}

/** 設定に出す詳しい表記。「v1.0.0（2026-09-05 ビルド / a1b2c3d）」 */
export function longVersion(info: BuildInfo = BUILD_INFO): string {
  const date = info.builtAt === '' ? '不明' : info.builtAt.slice(0, 10);
  return `v${info.version}（${date} ビルド / ${info.commit}）`;
}
