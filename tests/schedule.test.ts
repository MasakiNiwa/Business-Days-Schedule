import { describe, expect, it } from 'vitest';
import {
  expandRules,
  groupByDate,
  noticeDateOf,
  previewOccurrences,
  withMargin,
} from '../src/core/schedule';
import type { ScheduleContext } from '../src/core/schedule';
import type { Occurrence } from '../src/types';
import { companyCalendar, makeCalendar, makeRule, scheduleContext } from './helpers';

const dates = (occurrences: readonly Occurrence[]): string[] => occurrences.map((o) => o.date);

const salaryRule = makeRule({
  id: 'salary',
  title: '給与振込',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
});

describe('withMargin', () => {
  it('前後1か月ぶん月境界まで広げる', () => {
    expect(withMargin({ start: '2026-05-10', end: '2026-05-20' })).toEqual({
      start: '2026-04-01',
      end: '2026-06-30',
    });
  });
});

describe('expandRules', () => {
  it('無効なルールは展開しない', () => {
    const { occurrences } = expandRules(
      [{ ...salaryRule, enabled: false }],
      { start: '2026-01-01', end: '2026-12-31' },
      scheduleContext,
    );
    expect(occurrences).toEqual([]);
  });

  it('period で絞り込む', () => {
    const rule = makeRule({
      ...salaryRule,
      period: { start: '2026-03-01', end: '2026-05-31' },
    });
    const { occurrences } = expandRules(
      [rule],
      { start: '2026-01-01', end: '2026-12-31' },
      scheduleContext,
    );
    expect(dates(occurrences)).toEqual(['2026-03-25', '2026-04-24', '2026-05-25']);
  });

  it('skipDates は【基準日】で除外する', () => {
    // 2026-04-25 は土曜で確定日は 04-24。除外は基準日 04-25 を指定する。
    const rule = makeRule({ ...salaryRule, skipDates: ['2026-04-25'] });
    const { occurrences } = expandRules(
      [rule],
      { start: '2026-04-01', end: '2026-04-30' },
      scheduleContext,
    );
    expect(occurrences).toEqual([]);
  });

  it('補正の情報を保持する', () => {
    const { occurrences } = expandRules(
      [salaryRule],
      { start: '2026-04-01', end: '2026-04-30' },
      scheduleContext,
    );
    expect(occurrences[0]).toMatchObject({
      ruleId: 'salary',
      kind: 'main',
      rawDate: '2026-04-25',
      date: '2026-04-24',
      shifted: true,
      shiftDirection: 'prev',
    });
  });

  it('前月へ補正された発生日も表示範囲に現れる（マージンの検証）', () => {
    const rule = makeRule({
      id: 'monthStart',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [1], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
    });
    // 2026-08-01(土) → 前営業日 07-31。7月の表示範囲に現れること。
    const { occurrences } = expandRules(
      [rule],
      { start: '2026-07-01', end: '2026-07-31' },
      scheduleContext,
    );
    expect(dates(occurrences)).toEqual(['2026-07-01', '2026-07-31']);
  });

  it('同じ確定日に集まった発生を1件に統合する', () => {
    const rule = makeRule({
      id: 'merge',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [30, 31], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
    });
    // 2026-05-30(土) と 05-31(日) はどちらも 05-29(金) へ寄る。
    const { occurrences } = expandRules(
      [rule],
      { start: '2026-05-01', end: '2026-05-31' },
      scheduleContext,
    );
    expect(dates(occurrences)).toEqual(['2026-05-29']);
    expect(occurrences[0]?.rawDate).toBe('2026-05-30');
  });

  it('未知のカレンダーはフォールバックし警告を出す', () => {
    const rule = makeRule({ ...salaryRule, calendarId: 'missing' });
    const { occurrences, warnings } = expandRules(
      [rule],
      { start: '2026-04-01', end: '2026-04-30' },
      scheduleContext,
    );
    expect(dates(occurrences)).toEqual(['2026-04-24']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.reason).toBe('unknown-calendar');
  });

  it('補正先が見つからない発生日は警告のうえ除外する', () => {
    const allClosed: ScheduleContext = {
      calendars: new Map([['company', makeCalendar({ weekendDays: [0, 1, 2, 3, 4, 5, 6] })]]),
      fallbackCalendarId: 'company',
    };
    const { occurrences, warnings } = expandRules(
      [salaryRule],
      { start: '2026-04-01', end: '2026-04-30' },
      allClosed,
    );
    expect(occurrences).toEqual([]);
    expect(warnings.some((w) => w.reason === 'no-business-day')).toBe(true);
  });

  it('結果は日付昇順、同日なら本体が先', () => {
    const rules = [
      salaryRule,
      makeRule({
        id: 'weekly',
        recurrence: { type: 'weekly', interval: 1, weekdays: [1] },
        adjust: { mode: 'next', keepInMonth: false },
      }),
    ];
    const { occurrences } = expandRules(
      rules,
      { start: '2026-04-01', end: '2026-04-30' },
      scheduleContext,
    );
    const sorted = [...dates(occurrences)].sort();
    expect(dates(occurrences)).toEqual(sorted);
  });
});

describe('事前通知', () => {
  it('営業日換算で遡る', () => {
    expect(
      noticeDateOf('2026-09-24', { offset: -1, unit: 'business', label: '' }, companyCalendar),
    ).toBe('2026-09-18');
    expect(
      noticeDateOf('2026-09-24', { offset: -1, unit: 'calendar', label: '' }, companyCalendar),
    ).toBe('2026-09-23');
  });

  it('offset が 0 以上なら発生させない', () => {
    expect(noticeDateOf('2026-09-24', { offset: 0, unit: 'business', label: '' }, companyCalendar)).toBeNull();
  });

  it('本体の確定日を起点に展開される', () => {
    const rule = makeRule({
      ...salaryRule,
      notices: [{ offset: -3, unit: 'business', label: '振込データ作成' }],
    });
    const { occurrences } = expandRules(
      [rule],
      { start: '2026-04-01', end: '2026-04-30' },
      scheduleContext,
    );
    // 確定日 04-24(金) の3営業日前 → 04-21(火)
    expect(occurrences.map((o) => [o.kind, o.date])).toEqual([
      ['notice', '2026-04-21'],
      ['main', '2026-04-24'],
    ]);
    expect(occurrences[0]?.noticeLabel).toBe('振込データ作成');
  });

  it('表示範囲外の通知は切り落とされる', () => {
    const rule = makeRule({
      ...salaryRule,
      notices: [{ offset: -3, unit: 'business', label: '準備' }],
    });
    const { occurrences } = expandRules(
      [rule],
      { start: '2026-04-22', end: '2026-04-30' },
      scheduleContext,
    );
    expect(dates(occurrences)).toEqual(['2026-04-24']);
  });
});

describe('groupByDate', () => {
  it('日付ごとにまとめる', () => {
    const { occurrences } = expandRules(
      [salaryRule],
      { start: '2026-01-01', end: '2026-03-31' },
      scheduleContext,
    );
    const grouped = groupByDate(occurrences);
    expect([...grouped.keys()]).toEqual(['2026-01-23', '2026-02-25', '2026-03-25']);
    expect(grouped.get('2026-02-25')).toHaveLength(1);
  });
});

describe('previewOccurrences', () => {
  it('指定日以降の本体発生日を必要件数返す', () => {
    const preview = previewOccurrences(salaryRule, '2026-04-01', 5, scheduleContext);
    expect(dates(preview)).toEqual([
      '2026-04-24',
      '2026-05-25',
      '2026-06-25',
      '2026-07-24',
      '2026-08-25',
    ]);
  });

  it('無効なルールでもプレビューは出す', () => {
    const preview = previewOccurrences(
      { ...salaryRule, enabled: false },
      '2026-04-01',
      2,
      scheduleContext,
    );
    expect(dates(preview)).toEqual(['2026-04-24', '2026-05-25']);
  });

  it('年をまたいで探索する', () => {
    const yearly = makeRule({
      id: 'yearly',
      recurrence: { type: 'monthlyByDay', interval: 1, months: [4], days: [1], overflow: 'clamp' },
      adjust: { mode: 'next', keepInMonth: false },
    });
    expect(dates(previewOccurrences(yearly, '2026-05-01', 3, scheduleContext))).toEqual([
      '2027-04-01',
      '2028-04-03',
      '2029-04-02',
    ]);
  });

  it('発生しないルールは空を返す', () => {
    const expired = makeRule({ ...salaryRule, period: { start: null, end: '2020-01-01' } });
    expect(previewOccurrences(expired, '2026-01-01', 5, scheduleContext)).toEqual([]);
  });
});
