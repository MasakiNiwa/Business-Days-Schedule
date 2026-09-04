import { describe, expect, it } from 'vitest';
import { expandRecurrence, nthWeekdayOfMonth, skipsAdjustment } from '../src/core/recurrence';
import type { DateRange, Recurrence } from '../src/types';
import { companyCalendar, plainCalendar } from './helpers';

const range = (start: string, end: string): DateRange => ({ start, end });

function expand(recurrence: Recurrence, r: DateRange, anchor: string | null = null): string[] {
  return expandRecurrence(recurrence, r, { calendar: companyCalendar, anchor });
}

describe('weekly', () => {
  it('毎週指定した曜日を返す', () => {
    expect(
      expand({ type: 'weekly', interval: 1, weekdays: [5] }, range('2026-05-01', '2026-05-31')),
    ).toEqual(['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22', '2026-05-29']);
  });

  it('複数曜日を昇順で返す', () => {
    expect(
      expand({ type: 'weekly', interval: 1, weekdays: [1, 5] }, range('2026-05-01', '2026-05-12')),
    ).toEqual(['2026-05-01', '2026-05-04', '2026-05-08', '2026-05-11']);
  });

  it('隔週は anchor 起点で位相が決まる', () => {
    expect(
      expand(
        { type: 'weekly', interval: 2, weekdays: [1], anchor: '2026-04-06' },
        range('2026-04-01', '2026-06-30'),
      ),
    ).toEqual([
      '2026-04-06',
      '2026-04-20',
      '2026-05-04',
      '2026-05-18',
      '2026-06-01',
      '2026-06-15',
      '2026-06-29',
    ]);
  });

  it('隔週の位相は年をまたいでもずれない', () => {
    const recurrence: Recurrence = {
      type: 'weekly',
      interval: 2,
      weekdays: [1],
      anchor: '2026-04-06',
    };
    const dates = expand(recurrence, range('2026-12-01', '2027-02-01'));
    // anchor から 14 日刻みであることを確認する。
    for (const date of dates) {
      const diff = Math.round(
        (Date.parse(`${date}T00:00:00Z`) - Date.parse('2026-04-06T00:00:00Z')) / 86_400_000,
      );
      expect(diff % 14).toBe(0);
    }
    expect(dates.length).toBeGreaterThan(0);
  });

  it('anchor 省略時は period.start を位相基準にする', () => {
    expect(
      expand({ type: 'weekly', interval: 2, weekdays: [1] }, range('2026-04-01', '2026-05-01'), '2026-04-13'),
    ).toEqual(['2026-04-13', '2026-04-27']);
  });

  it('曜日未指定なら何も返さない', () => {
    expect(expand({ type: 'weekly', interval: 1, weekdays: [] }, range('2026-05-01', '2026-05-31'))).toEqual([]);
  });
});

describe('monthlyByDay', () => {
  it('毎月N日を返す', () => {
    expect(
      expand(
        { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
        range('2026-01-01', '2026-03-31'),
      ),
    ).toEqual(['2026-01-25', '2026-02-25', '2026-03-25']);
  });

  it('複数日を1ルールで表現できる', () => {
    expect(
      expand(
        { type: 'monthlyByDay', interval: 1, days: [10, 25], overflow: 'clamp' },
        range('2026-01-01', '2026-02-28'),
      ),
    ).toEqual(['2026-01-10', '2026-01-25', '2026-02-10', '2026-02-25']);
  });

  it('"last" は暦上の末日（うるう年を含む）', () => {
    expect(
      expand(
        { type: 'monthlyByDay', interval: 1, days: ['last'], overflow: 'clamp' },
        range('2024-01-01', '2024-04-30'),
      ),
    ).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
  });

  it('overflow: clamp は存在しない日を末日に丸める', () => {
    expect(
      expand(
        { type: 'monthlyByDay', interval: 1, days: [31], overflow: 'clamp' },
        range('2026-01-01', '2026-04-30'),
      ),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('overflow: skip は存在しない月を飛ばす', () => {
    expect(
      expand(
        { type: 'monthlyByDay', interval: 1, days: [31], overflow: 'skip' },
        range('2026-01-01', '2026-04-30'),
      ),
    ).toEqual(['2026-01-31', '2026-03-31']);
  });

  it('同じ日に落ちる指定は1件にまとめる', () => {
    expect(
      expand(
        { type: 'monthlyByDay', interval: 1, days: [31, 'last'], overflow: 'clamp' },
        range('2026-02-01', '2026-02-28'),
      ),
    ).toEqual(['2026-02-28']);
  });

  it('months で四半期・年次を表現できる', () => {
    expect(
      expand(
        { type: 'monthlyByDay', interval: 1, months: [3, 6, 9, 12], days: ['last'], overflow: 'clamp' },
        range('2026-01-01', '2026-12-31'),
      ),
    ).toEqual(['2026-03-31', '2026-06-30', '2026-09-30', '2026-12-31']);

    expect(
      expand(
        { type: 'monthlyByDay', interval: 1, months: [4], days: [1], overflow: 'clamp' },
        range('2026-01-01', '2027-12-31'),
      ),
    ).toEqual(['2026-04-01', '2027-04-01']);
  });

  it('interval は anchor の月から数える', () => {
    expect(
      expand(
        { type: 'monthlyByDay', interval: 3, days: [1], overflow: 'clamp' },
        range('2026-01-01', '2026-12-31'),
        '2026-02-01',
      ),
    ).toEqual(['2026-02-01', '2026-05-01', '2026-08-01', '2026-11-01']);
  });
});

describe('monthlyByWeekday', () => {
  it('第2・第4火曜を1ルールで表現できる', () => {
    expect(
      expand(
        { type: 'monthlyByWeekday', interval: 1, nth: [2, 4], weekday: 2 },
        range('2026-02-01', '2026-02-28'),
      ),
    ).toEqual(['2026-02-10', '2026-02-24']);
  });

  it('第5週が無い月は発生しない', () => {
    // 2026年の水曜が5回あるのは 4/7/9/12月。
    expect(
      expand(
        { type: 'monthlyByWeekday', interval: 1, nth: [5], weekday: 3 },
        range('2026-01-01', '2026-06-30'),
      ),
    ).toEqual(['2026-04-29']);
  });

  it('nth: -1 は必ず最終週を返す', () => {
    expect(
      expand(
        { type: 'monthlyByWeekday', interval: 1, nth: [-1], weekday: 3 },
        range('2026-03-01', '2026-05-31'),
      ),
    ).toEqual(['2026-03-25', '2026-04-29', '2026-05-27']);
  });

  it('nth: 5 と -1 が同じ日を指す月は1件に統合される', () => {
    expect(
      expand(
        { type: 'monthlyByWeekday', interval: 1, nth: [5, -1], weekday: 3 },
        range('2026-04-01', '2026-04-30'),
      ),
    ).toEqual(['2026-04-29']);
  });

  it('nthWeekdayOfMonth の境界', () => {
    expect(nthWeekdayOfMonth(2026, 9, 3, 1)).toBe('2026-09-02');
    expect(nthWeekdayOfMonth(2026, 9, 3, 5)).toBe('2026-09-30');
    expect(nthWeekdayOfMonth(2026, 2, 2, 5)).toBeNull();
    expect(nthWeekdayOfMonth(2026, 8, 1, -1)).toBe('2026-08-31');
  });
});

describe('monthlyByBusinessDay', () => {
  it('第N営業日を返す', () => {
    expect(
      expand(
        { type: 'monthlyByBusinessDay', interval: 1, nth: [5] },
        range('2026-08-01', '2026-09-30'),
      ),
    ).toEqual(['2026-08-07', '2026-09-07']);
  });

  it('負の値は月末からの営業日', () => {
    expect(
      expand(
        { type: 'monthlyByBusinessDay', interval: 1, nth: [-2] },
        range('2026-09-01', '2026-09-30'),
      ),
    ).toEqual(['2026-09-29']);
  });

  it('カレンダーが変われば結果も変わる', () => {
    const recurrence: Recurrence = { type: 'monthlyByBusinessDay', interval: 1, nth: [1] };
    const january = range('2026-01-01', '2026-01-31');
    expect(expandRecurrence(recurrence, january, { calendar: companyCalendar, anchor: null })).toEqual([
      '2026-01-05',
    ]);
    expect(expandRecurrence(recurrence, january, { calendar: plainCalendar, anchor: null })).toEqual([
      '2026-01-02',
    ]);
  });

  it('営業日補正の対象外である', () => {
    expect(skipsAdjustment({ type: 'monthlyByBusinessDay', interval: 1, nth: [1] })).toBe(true);
    expect(skipsAdjustment({ type: 'monthlyByDay', interval: 1, days: [1], overflow: 'clamp' })).toBe(false);
  });
});

describe('範囲の切り落とし', () => {
  it('range 外は返さない', () => {
    expect(
      expand(
        { type: 'monthlyByDay', interval: 1, days: [15], overflow: 'clamp' },
        range('2026-01-16', '2026-03-14'),
      ),
    ).toEqual(['2026-02-15']);
  });
});
