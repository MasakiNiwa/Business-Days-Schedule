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
 * グループで絞り込む。`group` が null なら絞らない。
 * 選択中のグループが消えた（最後の1件を消した・名前を変えた）ときは、
 * 何も出ないより全件を出すほうが安全なので、呼び出し側で null へ戻す。
 */
export function filterByGroup(rules: readonly Rule[], group: string | null): Rule[] {
  if (group === null) return [...rules];
  return rules.filter((rule) => groupOf(rule) === group);
}

/** 選択中のグループがまだ存在するか。消えていれば「すべて」へ戻す。 */
export function resolveActiveGroup(rules: readonly Rule[], group: string | null): string | null {
  if (group === null) return null;
  if (group === UNGROUPED) return hasUngrouped(rules) ? UNGROUPED : null;
  return collectGroups(rules).includes(group) ? group : null;
}
