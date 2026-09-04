import { describe, expect, it } from 'vitest';
import {
  describeAdjustment,
  describeNotice,
  describePeriod,
  describeRecurrence,
  describeRule,
} from '../src/core/describe';
import { makeRule } from './helpers';

describe('describeRecurrence', () => {
  it('weekly', () => {
    expect(describeRecurrence({ type: 'weekly', interval: 1, weekdays: [5] })).toBe('毎週金曜');
    expect(describeRecurrence({ type: 'weekly', interval: 1, weekdays: [1, 3] })).toBe('毎週月曜・水曜');
    expect(describeRecurrence({ type: 'weekly', interval: 2, weekdays: [1] })).toBe('隔週月曜');
    expect(describeRecurrence({ type: 'weekly', interval: 3, weekdays: [1] })).toBe('3週ごと月曜');
    expect(describeRecurrence({ type: 'weekly', interval: 1, weekdays: [] })).toBe('曜日未設定');
  });

  it('monthlyByDay', () => {
    const base = { type: 'monthlyByDay', interval: 1, overflow: 'clamp' } as const;
    expect(describeRecurrence({ ...base, days: [25] })).toBe('毎月25日');
    expect(describeRecurrence({ ...base, days: ['last'] })).toBe('毎月末日');
    expect(describeRecurrence({ ...base, days: [10, 25] })).toBe('毎月10日・25日');
    expect(describeRecurrence({ ...base, months: [3, 6, 9, 12], days: ['last'] })).toBe(
      '3・6・9・12月の末日',
    );
    expect(describeRecurrence({ ...base, months: [4], days: [1] })).toBe('毎年4月1日');
    expect(describeRecurrence({ ...base, interval: 2, days: [1] })).toBe('隔月1日');
  });

  it('monthlyByWeekday', () => {
    const base = { type: 'monthlyByWeekday', interval: 1 } as const;
    expect(describeRecurrence({ ...base, nth: [2, 4], weekday: 2 })).toBe('毎月第2・第4火曜');
    expect(describeRecurrence({ ...base, nth: [-1], weekday: 5 })).toBe('毎月最終金曜');
    expect(describeRecurrence({ ...base, months: [1, 7], nth: [1], weekday: 3 })).toBe(
      '1・7月の第1水曜',
    );
  });

  it('monthlyByBusinessDay', () => {
    const base = { type: 'monthlyByBusinessDay', interval: 1 } as const;
    expect(describeRecurrence({ ...base, nth: [5] })).toBe('毎月第5営業日');
    expect(describeRecurrence({ ...base, nth: [-1] })).toBe('毎月末営業日');
    expect(describeRecurrence({ ...base, nth: [-2] })).toBe('毎月末から2営業日前');
    expect(describeRecurrence({ ...base, months: [3, 9], nth: [-2] })).toBe(
      '3・9月の末から2営業日前',
    );
  });
});

describe('describeAdjustment', () => {
  it('補正モードを説明する', () => {
    expect(describeAdjustment({ mode: 'prev', keepInMonth: false })).toBe('休業日なら前営業日');
    expect(describeAdjustment({ mode: 'next', keepInMonth: false })).toBe('休業日なら翌営業日');
    expect(describeAdjustment({ mode: 'nearest', keepInMonth: false })).toBe('休業日なら近い営業日');
    expect(describeAdjustment({ mode: 'both', keepInMonth: false })).toBe(
      '休業日なら前後の営業日の両方',
    );
    expect(describeAdjustment({ mode: 'none', keepInMonth: false })).toBe('補正なし');
    expect(describeAdjustment({ mode: 'prev', keepInMonth: true })).toBe('休業日なら前営業日（当月内）');
  });

  it('第N営業日には補正の説明を付けない', () => {
    expect(
      describeAdjustment({ mode: 'prev', keepInMonth: false }, { type: 'monthlyByBusinessDay', interval: 1, nth: [5] }),
    ).toBe('');
  });
});

describe('describeRule', () => {
  it('反復条件と補正をつないで1行にする', () => {
    expect(
      describeRule(
        makeRule({
          recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
          adjust: { mode: 'prev', keepInMonth: false },
        }),
      ),
    ).toBe('毎月25日 / 休業日なら前営業日');

    expect(
      describeRule(
        makeRule({
          recurrence: { type: 'monthlyByBusinessDay', interval: 1, nth: [5] },
          adjust: { mode: 'none', keepInMonth: false },
        }),
      ),
    ).toBe('毎月第5営業日');
  });
});

describe('その他', () => {
  it('describeNotice', () => {
    expect(describeNotice(-3, 'business')).toBe('3営業日前');
    expect(describeNotice(-1, 'calendar')).toBe('1日前');
  });

  it('describePeriod', () => {
    expect(describePeriod({ start: null, end: null })).toBe('');
    expect(describePeriod({ start: '2026-04-01', end: null })).toBe('2026-04-01 〜');
    expect(describePeriod({ start: null, end: '2026-12-31' })).toBe('〜 2026-12-31');
    expect(describePeriod({ start: '2026-04-01', end: '2027-03-31' })).toBe('2026-04-01 〜 2027-03-31');
  });
});
