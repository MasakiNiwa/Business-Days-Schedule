/**
 * 詳細なルール（docs/SPEC.md §5.2 (f), §5.3, §5.4）。
 *
 * - 毎営業日 / N営業日ごと
 * - 休業日ならその回は行わない
 * - 暦日で数えた前後予定が休業日なら寄せる
 * - 前後予定ごとに数える営業日カレンダーを選ぶ
 */

import { describe, expect, it } from 'vitest';
import { AI_IMPORT_FORMAT, validateAiImport } from '../src/core/aiImport';
import { describeAdjustment, describeNoticeCalendar, describeRecurrence, describeTiming } from '../src/core/describe';
import { expandRecurrence } from '../src/core/recurrence';
import { expandRules, previewSeries } from '../src/core/schedule';
import { validateRule } from '../src/core/validate';
import type { Rule } from '../src/types';
import {
  bankCalendar,
  bankCalendarDef,
  companyCalendar,
  companyCalendarDef,
  makeRule,
  plainCalendar,
  scheduleContext,
} from './helpers';

const range = (start: string, end: string) => ({ start, end });
const mains = (rule: Rule, start: string, end: string): string[] =>
  expandRules([rule], range(start, end), scheduleContext)
    .occurrences.filter((o) => o.kind === 'main')
    .map((o) => o.date);

describe('毎営業日 / N営業日ごと', () => {
  it('毎営業日は営業日だけに出る', () => {
    const dates = expandRecurrence(
      { type: 'businessDays', interval: 1 },
      range('2026-11-01', '2026-11-30'),
      { calendar: plainCalendar, anchor: null },
    );
    // 2026年11月: 土日と 3日（文化の日）・23日（勤労感謝の日）を除く。
    expect(dates.every((date) => plainCalendar.isBusinessDay(date))).toBe(true);
    expect(dates).not.toContain('2026-11-03');
    expect(dates).not.toContain('2026-11-23');
    expect(dates).toHaveLength(plainCalendar.businessDaysOfMonth(2026, 11).length);
  });

  it('5営業日ごとは、基準日から営業日で数える（祝日をはさんでも間隔が崩れない）', () => {
    const dates = expandRecurrence(
      { type: 'businessDays', interval: 5, anchor: '2026-11-02' },
      range('2026-11-01', '2026-12-10'),
      { calendar: plainCalendar, anchor: null },
    );
    expect(dates[0]).toBe('2026-11-02');
    for (let i = 1; i < dates.length; i += 1) {
      const between = plainCalendar.addBusinessDays(dates[i - 1]!, 5);
      expect(dates[i]).toBe(between);
    }
  });

  it('範囲を分けて展開しても、同じ位相になる', () => {
    const recurrence = { type: 'businessDays' as const, interval: 3, anchor: '2026-01-05' };
    const ctx = { calendar: companyCalendar, anchor: null };
    const whole = expandRecurrence(recurrence, range('2026-10-01', '2026-12-31'), ctx);
    const split = [
      ...expandRecurrence(recurrence, range('2026-10-01', '2026-11-15'), ctx),
      ...expandRecurrence(recurrence, range('2026-11-16', '2026-12-31'), ctx),
    ];
    expect(split).toEqual(whole);
  });

  it('基準日が範囲より後でも、さかのぼって同じ位相で出る', () => {
    const recurrence = { type: 'businessDays' as const, interval: 4, anchor: '2026-12-01' };
    const ctx = { calendar: plainCalendar, anchor: null };
    const dates = expandRecurrence(recurrence, range('2026-11-01', '2026-12-31'), ctx);
    expect(dates).toContain('2026-12-01');
    const before = dates.filter((date) => date < '2026-12-01');
    expect(plainCalendar.addBusinessDays(before[before.length - 1]!, 4)).toBe('2026-12-01');
  });

  it('休業日の補正は効かない（設定してあっても動かさない）', () => {
    const rule = makeRule({
      recurrence: { type: 'businessDays', interval: 1 },
      adjust: { mode: 'next', keepInMonth: false },
    });
    const occurrences = expandRules([rule], range('2026-11-01', '2026-11-30'), scheduleContext).occurrences;
    expect(occurrences.every((o) => !o.shifted)).toBe(true);
  });

  it('説明は「毎営業日」「5営業日ごと」', () => {
    expect(describeRecurrence({ type: 'businessDays', interval: 1 })).toBe('毎営業日');
    expect(describeRecurrence({ type: 'businessDays', interval: 5 })).toBe('5営業日ごと');
    expect(describeAdjustment({ mode: 'prev', keepInMonth: false }, { type: 'businessDays', interval: 1 })).toBe('');
  });
});

describe('休業日ならその回は行わない', () => {
  // 2026-11-23（月）は勤労感謝の日。
  const mondays = makeRule({
    title: '定例',
    recurrence: { type: 'weekly', interval: 1, weekdays: [1] },
    adjust: { mode: 'skip', keepInMonth: false },
  });

  it('休業日にあたった回は出さない。ほかの回はそのまま', () => {
    expect(mains(mondays, '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-30',
    ]);
  });

  it('意図どおりなので警告しない', () => {
    const { warnings } = expandRules([mondays], range('2026-11-01', '2026-11-30'), scheduleContext);
    expect(warnings).toEqual([]);
  });

  it('プレビューでも同じ', () => {
    const series = previewSeries(mondays, '2026-11-17', 2, scheduleContext);
    expect(series.map((item) => item.main.date)).toEqual(['2026-11-30', '2026-12-07']);
  });

  it('説明と検証', () => {
    expect(describeAdjustment(mondays.adjust, mondays.recurrence)).toBe('休業日ならその回は行わない');
    expect(validateRule(mondays)).toEqual([]);
  });
});

describe('暦日で数えた前後予定が休業日なら寄せる', () => {
  // 本体 2026-11-30（月）。7日前は 11-23（勤労感謝の日）。
  const rule = (onClosed?: 'prev' | 'next' | 'none'): Rule =>
    makeRule({
      title: '期限',
      calendarId: 'plain',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [30], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [
        {
          id: 'n',
          label: '準備',
          timing: { kind: 'offset', offset: -7, unit: 'calendar', ...(onClosed === undefined ? {} : { onClosed }) },
        },
      ],
    });
  const noticeOf = (r: Rule) =>
    previewSeries(r, '2026-11-01', 1, scheduleContext)[0]?.related[0];

  it('指定なしならそのままの日', () => {
    expect(noticeOf(rule())?.date).toBe('2026-11-23');
  });

  it('前営業日へ／翌営業日へ寄せ、寄せる前の日も残す', () => {
    expect(noticeOf(rule('prev'))).toMatchObject({ date: '2026-11-20', noticeMovedFrom: '2026-11-23' });
    expect(noticeOf(rule('next'))).toMatchObject({ date: '2026-11-24', noticeMovedFrom: '2026-11-23' });
  });

  it('説明に添える', () => {
    expect(describeTiming({ kind: 'offset', offset: -7, unit: 'calendar', onClosed: 'prev' })).toBe(
      '7日前 / 休業日なら前営業日へ',
    );
    expect(describeTiming({ kind: 'offset', offset: -3, unit: 'business' })).toBe('3営業日前');
  });

  it('検証: 知らない値は弾く', () => {
    const bad = rule();
    (bad.notices[0]!.timing as Record<string, unknown>)['onClosed'] = 'later';
    expect(validateRule(bad).some((issue) => issue.severity === 'error')).toBe(true);
    expect(validateRule(rule('prev'))).toEqual([]);
  });
});

describe('前後予定ごとに数える営業日カレンダー', () => {
  // 本体 2027-01-05（火）、3営業日前を自社カレンダーと銀行で数えると変わる
  // （自社は 12-29〜01-03、銀行は 12-31〜01-03 が休業）。
  const rule = (calendarId?: string): Rule =>
    makeRule({
      title: '支払',
      calendarId: 'bank',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [5], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
      notices: [
        {
          id: 'n',
          label: '社内承認',
          timing: { kind: 'offset', offset: -3, unit: 'business' },
          ...(calendarId === undefined ? {} : { calendarId }),
        },
      ],
    });
  const noticeDateOf = (r: Rule) =>
    previewSeries(r, '2027-01-01', 1, scheduleContext)[0]?.related[0]?.date;

  it('指定なしなら本体と同じカレンダーで数える', () => {
    expect(noticeDateOf(rule())).toBe(bankCalendar.addBusinessDays('2027-01-05', -3));
  });

  it('指定すればそのカレンダーで数える', () => {
    const date = noticeDateOf(rule('company'));
    expect(date).toBe(companyCalendar.addBusinessDays('2027-01-05', -3));
    expect(date).not.toBe(bankCalendar.addBusinessDays('2027-01-05', -3));
  });

  it('カレンダー表示（展開）でも同じ日になる', () => {
    const occurrences = expandRules([rule('company')], range('2026-12-01', '2027-01-31'), scheduleContext)
      .occurrences;
    expect(occurrences.find((o) => o.kind === 'notice' && o.rawDate === '2027-01-05')?.date).toBe(
      companyCalendar.addBusinessDays('2027-01-05', -3),
    );
  });

  it('見つからないカレンダーなら本体と同じで数える', () => {
    expect(noticeDateOf(rule('gone'))).toBe(bankCalendar.addBusinessDays('2027-01-05', -3));
  });

  it('説明は本体と違うときだけ添える', () => {
    const names = (id: string) => (id === 'company' ? '自社カレンダー' : '銀行休業日');
    expect(describeNoticeCalendar({ calendarId: 'company' }, 'bank', names)).toBe('（自社カレンダーで数える）');
    expect(describeNoticeCalendar({ calendarId: 'bank' }, 'bank', names)).toBe('');
    expect(describeNoticeCalendar({}, 'bank', names)).toBe('');
  });

  it('検証: 空の id は弾く', () => {
    expect(validateRule(rule('')).some((issue) => issue.path === 'notices[0].calendarId')).toBe(true);
    expect(validateRule(rule('company'))).toEqual([]);
  });
});

describe('AI の回答からも作れる', () => {
  const ctx = { calendars: [companyCalendarDef, bankCalendarDef], now: new Date('2026-10-01T00:00:00.000Z') };
  const file = (rules: unknown[]) => ({ format: AI_IMPORT_FORMAT, schemaVersion: 1, rules });

  it('毎営業日・スキップ・暦日の寄せ・前後予定のカレンダーを読む', () => {
    const result = validateAiImport(
      file([
        { title: '残高確認', recurrence: { type: 'businessDays', interval: 1 } },
        { title: '定例', recurrence: { type: 'weekly', weekdays: [1] }, adjust: { mode: 'skip' } },
        {
          title: '支払',
          calendarId: 'bank',
          recurrence: { type: 'monthlyByDay', days: [25] },
          adjust: { mode: 'prev' },
          notices: [
            { label: '社内承認', timing: { kind: 'offset', offset: -3, unit: 'business' }, calendarId: 'company' },
            { label: '期限確認', timing: { kind: 'offset', offset: -7, unit: 'calendar', onClosed: 'prev' } },
          ],
        },
      ]),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [daily, weekly, payment] = result.rules;
    expect(daily?.recurrence).toEqual({ type: 'businessDays', interval: 1 });
    expect(daily?.adjust.mode).toBe('none');
    expect(weekly?.adjust.mode).toBe('skip');
    expect(payment?.notices[0]?.calendarId).toBe('company');
    expect(payment?.notices[1]?.timing).toEqual({ kind: 'offset', offset: -7, unit: 'calendar', onClosed: 'prev' });
  });

  it('N営業日ごとで数え始めの日が無ければ警告する', () => {
    const result = validateAiImport(file([{ title: '資金繰り', recurrence: { type: 'businessDays', interval: 5 } }]), ctx);
    expect(result.ok).toBe(true);
    expect(result.issues[0]).toMatchObject({ severity: 'warning', path: 'rules[0].recurrence.anchor' });
  });

  it('前後予定の知らないカレンダーはエラー', () => {
    const result = validateAiImport(
      file([
        {
          title: '支払',
          recurrence: { type: 'monthlyByDay', days: [25] },
          adjust: { mode: 'prev' },
          notices: [{ label: '承認', timing: { kind: 'offset', offset: -3, unit: 'business' }, calendarId: 'head-office' }],
        },
      ]),
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.issues.find((issue) => issue.severity === 'error')?.path).toBe('rules[0].notices[0].calendarId');
  });

  it('営業日で数える前後予定の onClosed は落として知らせる（意味は変わらない）', () => {
    const result = validateAiImport(
      file([
        {
          title: '支払',
          recurrence: { type: 'monthlyByDay', days: [25] },
          adjust: { mode: 'prev' },
          notices: [{ label: '承認', timing: { kind: 'offset', offset: -3, unit: 'business', onClosed: 'prev' } }],
        },
      ]),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rules[0]?.notices[0]?.timing).toEqual({ kind: 'offset', offset: -3, unit: 'business' });
    expect(result.issues[0]).toMatchObject({ severity: 'warning', path: 'rules[0].notices[0].timing.onClosed' });
  });
});
