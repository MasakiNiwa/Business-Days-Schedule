/**
 * アプリの名前と版。画面と設定に出し、不具合の報告時に突き合わせられるようにする。
 */

/** 画面・書き出し・文書で共通に使う呼び名。ばらけると同じものに見えなくなる。 */
export const APP_NAME = 'Business Days Schedule';

/**
 * 何をするものかを一言で。反復ルールを組み立てるところがこのアプリの役目で、
 * 日々見るのは会社で使っているカレンダーであることが多い。その関係を最初に伝える。
 *
 * 前半を分けて持つのは、そこが他のカレンダーには無い部分だからである。
 * 「反復ルール」だけなら Outlook にもあるが、休祝日で前後にずらすことと、
 * 決算月から逆算することはできない。画面ではそこを強調して出す。
 */
export const APP_TAGLINE_LEAD = '営業日/決算月を反映した';
export const APP_TAGLINE_REST = '反復ルールを組んで、Outlook / Google カレンダーへ';

/** 強調を持てない場所（説明文・文書）向けの通し表記。 */
export const APP_TAGLINE = `${APP_TAGLINE_LEAD}${APP_TAGLINE_REST}`;

export type BuildInfo = {
  version: string;
  /** その版を公開した日（YYYY-MM-DD）。アプリの日付として出すのはこちら。 */
  releasedAt: string;
  /**
   * ビルドした日時。祝日データの週次更新で作り直すたびに変わるので、
   * 「いつの版か」の目印には使わない（設定の詳細にだけ出す）。
   */
  builtAt: string;
  commit: string;
};

export const BUILD_INFO: BuildInfo = {
  version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
  releasedAt: typeof __APP_RELEASED_AT__ === 'string' ? __APP_RELEASED_AT__ : '',
  builtAt: typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : '',
  commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown',
};

/** 画面に出す短い表記。「v1.0.0」 */
export function shortVersion(info: BuildInfo = BUILD_INFO): string {
  return `v${info.version}`;
}

/**
 * 詳しい表記。「v1.0.0（2026-09-05 公開 / a1b2c3d）」
 *
 * 日付は版を出した日。ビルド日時にすると、祝日データだけを更新した週次の
 * 再公開でも日付が進み、アプリが更新されたように見えてしまう。
 */
export function longVersion(info: BuildInfo = BUILD_INFO): string {
  const date = info.releasedAt === '' ? '公開日不明' : `${info.releasedAt} 公開`;
  return `v${info.version}（${date} / ${info.commit}）`;
}
