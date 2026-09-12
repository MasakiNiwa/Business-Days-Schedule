/**
 * 保存の競合（docs/SPEC.md §9.1）。
 *
 * 同じ保存領域を2つのタブで使うと、後から保存したほうが先の変更を丸ごと
 * 消してしまう。画面には自分が開いたときの内容しか出ていないので、消したことにも
 * 気づけない。どちらを残すかは持ち主にしか決められないため、黙って上書きせずに
 * 見つけて尋ねられるようにする。
 */

import type { Rule } from '../types';

/**
 * 中身だけを見る姿。`updatedAt` は保存のたびに付け替わるので外す。
 * 別のタブが同じ内容を保存し直しただけのときに、競合として止めないため。
 */
export function ruleFingerprint(rule: Rule): string {
  const { updatedAt: _updatedAt, ...rest } = rule;
  return JSON.stringify(rest);
}

export type SaveConflict =
  /** 誰も触っていない。そのまま保存してよい。 */
  | 'none'
  /** 編集を始めたあとに、別のところで中身が変わった。 */
  | 'changed'
  /** 編集を始めたあとに、別のところで消された。 */
  | 'deleted';

/**
 * 保存しようとしているルールが、編集を始めたあとに書き換えられていないか。
 *
 * @param saved    いま保存されている一覧（手元の状態ではなく、読み直したもの）
 * @param ruleId   保存しようとしているルールの id
 * @param baseline 編集を始めた時点の `ruleFingerprint`。新規なら null
 */
export function detectSaveConflict(
  saved: readonly Rule[],
  ruleId: string,
  baseline: string | null,
): SaveConflict {
  // 新規は比べる相手がいない。同じ id が既にあるなら、それは別の事故なので
  // ここでは扱わない（id は作るたびに新しく振る）。
  if (baseline === null) return 'none';
  const current = saved.find((rule) => rule.id === ruleId);
  if (current === undefined) return 'deleted';
  return ruleFingerprint(current) === baseline ? 'none' : 'changed';
}

/**
 * 保存済みの一覧へ1件を差し込む。
 *
 * 差し込む先は**読み直した一覧**にする。開いたときの古い一覧へ差し込んで
 * 書き戻すと、その間に別のタブが増やしたルールを消してしまう。
 */
export function upsertRule(saved: readonly Rule[], rule: Rule): Rule[] {
  const index = saved.findIndex((item) => item.id === rule.id);
  if (index === -1) return [...saved, rule];
  return saved.map((item) => (item.id === rule.id ? rule : item));
}
