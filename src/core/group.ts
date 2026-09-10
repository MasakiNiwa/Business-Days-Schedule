/**
 * ルールのグループ（docs/SPEC.md §5.5）。
 *
 * 実務では「税務」「入金」「社内」のように束で見たい・束で渡したいことが多い。
 * 独立した実体にせず、ルールが持つ文字列として扱う。名前を変えるだけで束ね直せ、
 * 空になったグループを別途片付ける必要も無いため。
 */

import type { Rule } from '../types';

/** グループを付けていないルールの受け皿。実データとしては空文字で持つ。 */
export const UNGROUPED = '';

/** 画面に出すときの「未分類」の呼び名。 */
export const UNGROUPED_LABEL = '未分類';

/** 表示・比較に使う正規化。前後の空白差だけで別グループになると混乱するため。 */
export function groupOf(rule: Rule): string {
  return (rule.group ?? '').trim();
}

export function groupLabel(group: string): string {
  return group === UNGROUPED ? UNGROUPED_LABEL : group;
}

/**
 * 使われているグループの一覧。名前順に並べ、未分類は含めない。
 * 未分類を混ぜると「すべて」との違いが分かりにくくなるため、呼び出し側で足す。
 */
export function collectGroups(rules: readonly Rule[]): string[] {
  const seen = new Set<string>();
  for (const rule of rules) {
    const group = groupOf(rule);
    if (group !== UNGROUPED) seen.add(group);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'ja'));
}

/** 未分類のルールがあるか。選択肢に「未分類」を出すかの判断に使う。 */
export function hasUngrouped(rules: readonly Rule[]): boolean {
  return rules.some((rule) => groupOf(rule) === UNGROUPED);
}

/**
 * グループで絞り込む。`groups` が null なら絞らない。
 *
 * 複数を選べるようにしてあるのは、「税務」と「入金」だけをまとめて見たい、
 * のような使い方が実際にあるため。1つずつしか選べないと、見比べるたびに
 * 選び直すことになる。
 */
export function filterByGroups(rules: readonly Rule[], groups: readonly string[] | null): Rule[] {
  if (groups === null) return [...rules];
  const wanted = new Set(groups);
  return rules.filter((rule) => wanted.has(groupOf(rule)));
}

/**
 * 選択中のグループのうち、まだ存在するものだけを残す。
 *
 * 名前を変えた・最後の1件を消したなどで消えたものは落とす。
 * 全部消えて空になったら null（すべて）へ戻す。何も出ない画面より安全なため。
 */
export function resolveActiveGroups(
  rules: readonly Rule[],
  groups: readonly string[] | null,
): string[] | null {
  if (groups === null) return null;
  const known = new Set(collectGroups(rules));
  if (hasUngrouped(rules)) known.add(UNGROUPED);
  const alive = [...new Set(groups)].filter((group) => known.has(group));
  return alive.length === 0 ? null : alive;
}

/** そのグループに属するルール。まとめて消すときの対象を数えるのに使う。 */
export function rulesInGroup(rules: readonly Rule[], group: string): Rule[] {
  return rules.filter((rule) => groupOf(rule) === group);
}

/** グループ名の上限。読み込み側の検証（LIMITS.groupLength）と必ず揃える。 */
export const GROUP_NAME_MAX = 40;

export type RenameGroupResult =
  | { ok: true; rules: Rule[] }
  | { ok: false; reason: string };

/**
 * グループ名をまとめて付け替える。
 *
 * グループは実体ではなくルールが持つ文字列なので、付け替えは
 * 「その名前を持つルールを全部書き換える」ことになる。1件ずつ編集させると
 * 取りこぼす。`to` を空にすると未分類へ移す。
 *
 * **長さは必ずここで確かめる。** 読み込み側は上限を超えるグループ名を持つ
 * ルールを不正として捨てるため、検証せずに保存すると、その束のルールが
 * 再読込で丸ごと消える。さらにその状態で保存し直すと、消えたまま上書きされる。
 * 実際に「支払」の2件が消える状態になっていた。
 *
 * 弾くときは1件も書き換えない。一部だけ変えると、同じ束が2つの名前に割れる。
 */
export function renameGroup(rules: readonly Rule[], from: string, to: string): RenameGroupResult {
  const target = to.trim();
  if (target.length > GROUP_NAME_MAX) {
    return {
      ok: false,
      reason: `グループ名は ${GROUP_NAME_MAX} 文字までにしてください（${target.length} 文字）。`,
    };
  }
  return {
    ok: true,
    rules: rules.map((rule) =>
      groupOf(rule) === from ? { ...rule, group: target, updatedAt: rule.updatedAt } : rule,
    ),
  };
}

/**
 * 選んだグループの呼び名。すべてなら null。
 *
 * 書き出したファイル名や取り込み先のカレンダー名になる。
 * 複数選んだときは並べる。何を渡したのかが後から分かるようにするため。
 */
export function groupsLabel(groups: readonly string[] | null): string | null {
  if (groups === null || groups.length === 0) return null;
  return groups.map(groupLabel).join('・');
}
