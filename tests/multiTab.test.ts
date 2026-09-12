/**
 * 保存の競合（docs/SPEC.md §9.1）。
 *
 * 同じ保存領域を2つのタブで使うと、後から保存したほうが先の変更を丸ごと
 * 消してしまう。画面には自分が開いたときの内容しか出ていないので、消したことにも
 * 気づけない。「表示設定の保存でルールが消える」は別に直したが、同じルールを
 * 両方のタブで開いたときの競合は残っていた。
 */

import { describe, expect, it } from 'vitest';
import { detectSaveConflict, ruleFingerprint, upsertRule } from '../src/core/conflict';
import type { Rule } from '../src/types';
import { makeRule } from './helpers';

const monthlyClose = (days: number[], extra: Partial<Rule> = {}): Rule =>
  makeRule({
    id: 'close',
    title: '月次締め',
    recurrence: { type: 'monthlyByDay', interval: 1, days, overflow: 'clamp' },
    adjust: { mode: 'prev', keepInMonth: false },
    ...extra,
  });

describe('ruleFingerprint', () => {
  it('保存時刻の違いだけでは変わらない', () => {
    // 別のタブが同じ内容を保存し直しただけのときに、競合として止めないため。
    const a = monthlyClose([25]);
    const b = { ...a, updatedAt: '2027-01-01T00:00:00.000Z' };
    expect(ruleFingerprint(a)).toBe(ruleFingerprint(b));
  });

  it('中身が違えば変わる', () => {
    expect(ruleFingerprint(monthlyClose([25]))).not.toBe(ruleFingerprint(monthlyClose([20])));
    expect(ruleFingerprint(monthlyClose([25]))).not.toBe(
      ruleFingerprint(monthlyClose([25], { note: 'メモ' })),
    );
  });
});

describe('detectSaveConflict', () => {
  const opened = monthlyClose([25]);
  const baseline = ruleFingerprint(opened);

  it('誰も触っていなければ競合しない', () => {
    expect(detectSaveConflict([opened], 'close', baseline)).toBe('none');
  });

  it('別のタブが中身を変えていたら見つける', () => {
    // タブ B が編集中に、タブ A が「毎月25日」を「毎月20日」にした。
    expect(detectSaveConflict([monthlyClose([20])], 'close', baseline)).toBe('changed');
  });

  it('保存し直されただけなら競合としない', () => {
    const resaved = { ...opened, updatedAt: '2027-01-01T00:00:00.000Z' };
    expect(detectSaveConflict([resaved], 'close', baseline)).toBe('none');
  });

  it('別のタブが消していたら、それも知らせる', () => {
    expect(detectSaveConflict([], 'close', baseline)).toBe('deleted');
  });

  it('新規作成は比べる相手がいないので競合しない', () => {
    expect(detectSaveConflict([], 'fresh', null)).toBe('none');
  });
});

describe('upsertRule', () => {
  it('既存は差し替える', () => {
    const result = upsertRule([monthlyClose([20]), makeRule({ id: 'other' })], monthlyClose([25]));
    expect(result).toHaveLength(2);
    expect(result[0]?.recurrence).toMatchObject({ days: [25] });
  });

  it('無ければ足す', () => {
    const result = upsertRule([makeRule({ id: 'other' })], monthlyClose([25]));
    expect(result.map((rule) => rule.id)).toEqual(['other', 'close']);
  });

  it('別のタブが増やしたルールを落とさない', () => {
    // 差し込む先は読み直した一覧。開いたときの古い一覧へ差し込んで書き戻すと、
    // その間に増えたものが消える。
    const savedNow = [monthlyClose([25]), makeRule({ id: 'added-by-other-tab' })];
    const result = upsertRule(savedNow, monthlyClose([25], { note: 'メモ' }));
    expect(result.map((rule) => rule.id)).toEqual(['close', 'added-by-other-tab']);
    expect(result[0]?.note).toBe('メモ');
  });
});
