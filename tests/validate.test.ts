import { describe, expect, it } from 'vitest';
import { LIMITS, hasError, validateCalendar, validateRule } from '../src/core/validate';
import { companyCalendarDef, makeRule } from './helpers';
import type { Rule } from '../src/types';

describe('validateRule', () => {
  it('妥当なルールは問題なし', () => {
    expect(validateRule(makeRule({ title: '給与振込' }))).toEqual([]);
  });

  it('タイトル未入力を検出する', () => {
    const issues = validateRule(makeRule({ title: '  ' }));
    expect(issues.map((i) => i.path)).toContain('title');
  });

  it('interval は1以上', () => {
    const issues = validateRule(
      makeRule({ title: 'x', recurrence: { type: 'monthlyByDay', interval: 0, days: [1], overflow: 'clamp' } }),
    );
    expect(issues.map((i) => i.path)).toContain('recurrence.interval');
  });

  it('weekly は曜日が必須', () => {
    const issues = validateRule(
      makeRule({ title: 'x', recurrence: { type: 'weekly', interval: 1, weekdays: [] } }),
    );
    expect(issues.map((i) => i.path)).toContain('recurrence.weekdays');
  });

  it('日の範囲を検証する', () => {
    const issues = validateRule(
      makeRule({ title: 'x', recurrence: { type: 'monthlyByDay', interval: 1, days: [0, 32], overflow: 'clamp' } }),
    );
    expect(issues.filter((i) => i.path === 'recurrence.days')).toHaveLength(2);
  });

  it('第N営業日に0は指定できない', () => {
    const issues = validateRule(
      makeRule({ title: 'x', recurrence: { type: 'monthlyByBusinessDay', interval: 1, nth: [0] } }),
    );
    expect(issues.map((i) => i.path)).toContain('recurrence.nth');
  });

  it('period の前後関係を検証する', () => {
    const issues = validateRule(
      makeRule({ title: 'x', period: { start: '2026-05-01', end: '2026-04-01' } }),
    );
    expect(issues.map((i) => i.path)).toContain('period');
  });

  it('準備日（負）とフォロー（正）のどちらも受け付ける', () => {
    for (const offset of [-3, 5]) {
      const issues = validateRule(
        makeRule({ title: 'x', notices: [{ offset, unit: 'business', label: '確認' }] }),
      );
      expect(issues.map((i) => i.path), `offset=${offset}`).not.toContain('notices[0].offset');
    }
  });

  it('0 は本体と同じ日なので弾く', () => {
    const issues = validateRule(
      makeRule({ title: 'x', notices: [{ offset: 0, unit: 'business', label: '確認' }] }),
    );
    expect(issues.map((i) => i.path)).toContain('notices[0].offset');
  });

  it('前後どちらも上限を超えたら弾く', () => {
    // 営業日換算の巨大な値は、数えるだけで固まるため。
    for (const offset of [-LIMITS.noticeOffset - 1, LIMITS.noticeOffset + 1]) {
      const issues = validateRule(
        makeRule({ title: 'x', notices: [{ offset, unit: 'business', label: '確認' }] }),
      );
      expect(issues.map((i) => i.path), `offset=${offset}`).toContain('notices[0].offset');
    }
  });

  it('除外日の形式を検証する', () => {
    const issues = validateRule(makeRule({ title: 'x', skipDates: ['2026-02-30'] }));
    expect(issues.map((i) => i.path)).toContain('skipDates');
  });
});

describe('validateCalendar', () => {
  it('既定カレンダーは問題なし', () => {
    expect(validateCalendar(companyCalendarDef)).toEqual([]);
  });

  it('全曜日休業は警告（エラーではない）', () => {
    const issues = validateCalendar({ ...companyCalendarDef, weekendDays: [0, 1, 2, 3, 4, 5, 6] });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('warning');
    expect(hasError(issues)).toBe(false);
  });

  it('休業期間の形式を検証する', () => {
    const issues = validateCalendar({
      ...companyCalendarDef,
      closedRanges: [{ from: '12/29', to: '01-03', label: 'x' }],
    });
    expect(hasError(issues)).toBe(true);
  });
});

describe('グループ', () => {
  it('長すぎるグループ名を弾く', () => {
    // 選ぶための札なので、長い文章を入れる場所ではない。
    const rule = makeRule({ title: '納付', group: 'あ'.repeat(LIMITS.groupLength + 1) });
    expect(validateRule(rule).map((issue) => issue.path)).toContain('group');
    expect(hasError(validateRule(rule))).toBe(true);
  });

  it('未設定でも通る（未分類として扱う）', () => {
    expect(hasError(validateRule(makeRule({ title: '納付' })))).toBe(false);
    expect(hasError(validateRule(makeRule({ title: '納付', group: '税務' })))).toBe(false);
  });

  it('文字列でないグループを弾く', () => {
    // validateRule は任意の値を受ける前提なので、型を外して渡す。
    const rule = { ...makeRule({ title: '納付' }), group: 42 } as unknown as Rule;
    expect(hasError(validateRule(rule))).toBe(true);
  });
});
