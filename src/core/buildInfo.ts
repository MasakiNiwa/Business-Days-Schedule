/**
 * 版の情報。画面と設定に出し、不具合の報告時に突き合わせられるようにする。
 */

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
