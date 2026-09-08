/**
 * 前後予定（準備日・フォロー）の識別子（docs/SPEC.md §5.4）。
 *
 * 外部カレンダーの UID に配列の順番を使っていたため、1件消すと残りの識別子が
 * ずれ、消したものの識別子を引き継いでしまっていた。取り込み先では、
 * 別の予定として増えたり、別の予定を上書きしたりする原因になる。
 *
 * 固定の id を持たせて解決する。ただし既に書き出したぶんの UID を変えたくないので、
 * 古いデータには「今の順番」から `n0`, `n1`, … を割り当てる。こうすると
 * 移行の時点では UID が変わらず、そのあとの削除・並べ替えでも動かなくなる。
 */

import type { Notice, Rule } from '../types';

/** 順番から作る既定の id。移行時に既存の UID と一致させるための形。 */
export const legacyNoticeId = (index: number): string => `n${index}`;

/** 衝突しない新しい id。既存の `n0` 形式とぶつからないよう別の形にする。 */
function freshNoticeId(used: ReadonlySet<string>): string {
  for (let attempt = 0; ; attempt += 1) {
    const candidate = `x${Date.now().toString(36)}${attempt.toString(36)}${Math.floor(
      Math.random() * 1296,
    )
      .toString(36)
      .padStart(2, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** 1件ぶんの新しい前後予定。id を先に決めておく。 */
export function createNotice(notice: Omit<Notice, 'id'>, existing: readonly Notice[] = []): Notice {
  const used = new Set(existing.map((item) => item.id).filter((id): id is string => id !== undefined));
  return { id: freshNoticeId(used), ...notice };
}

/**
 * id を持たない前後予定に id を補う。読み込み・取り込みの時点で1度だけ行う。
 * 既にあるものは触らない。重複していたら後のほうを付け直す。
 */
export function withNoticeIds(notices: readonly Notice[]): Notice[] {
  const used = new Set<string>();
  return notices.map((notice, index) => {
    const preferred = notice.id ?? legacyNoticeId(index);
    if (!used.has(preferred)) {
      used.add(preferred);
      return notice.id === undefined ? { ...notice, id: preferred } : notice;
    }
    const fresh = freshNoticeId(used);
    used.add(fresh);
    return { ...notice, id: fresh };
  });
}

export function ruleWithNoticeIds(rule: Rule): Rule {
  const notices = withNoticeIds(rule.notices);
  return notices.every((notice, index) => notice === rule.notices[index])
    ? rule
    : { ...rule, notices };
}
