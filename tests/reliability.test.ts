import { describe, expect, it } from 'vitest';
import { createBusinessDayCalendar, createDefaultCalendars } from '../src/core/businessDay';
import { createEmptyHolidayLookup } from '../src/core/holidays';
import { createDefaultState, createRule, importState } from '../src/core/storage';
import { expandBoundsFor, expandRules, noticeDateOf } from '../src/core/schedule';
import type { ScheduleContext } from '../src/core/schedule';
import type { BusinessDayCalendar } from '../src/core/businessDay';
import { addDays, weekdayOf } from '../src/core/dateUtil';
import type { Rule } from '../src/types';
import { companyCalendar, companyCalendarDef, holidays, makeRule } from './helpers';
import { buildIcs } from '../src/core/exportCalendar';
import { validatePublishedHolidays, buildHolidayData } from '../scripts/build-holidays';

describe('再レビューの回帰', () => {
  it.each(['replace', 'merge', 'add'] as const)('表示設定も %s 取り込み時に検証する', (mode) => {
    const result = importState({ schemaVersion: 1, rules: [], calendars: [], prefs: {
      defaultView: 'list', listDays: 1_000_000_000, addedSamplePacks: 42, theme: 'wrong',
    } }, createDefaultState(), mode);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.prefs).toEqual({ ...createDefaultState().prefs, defaultView: 'list' });
  });

  it('月曜だけ営業する場合の60営業日前を取りこぼさない', () => {
    const calendar = createBusinessDayCalendar({ ...createDefaultCalendars()[0]!,
      weekendDays: [0, 2, 3, 4, 5, 6], closedRanges: [],
    }, createEmptyHolidayLookup());
    const rule = createRule({ title: '長期準備', recurrence: { type: 'monthlyByDay', interval: 1, months: [11], days: [30], overflow: 'clamp' },
      period: { start: '2026-11-30', end: '2026-11-30' }, adjust: { mode: 'none', keepInMonth: false },
      notices: [{ offset: -60, unit: 'business', label: '準備' }],
    });
    expect(noticeDateOf('2026-11-30', rule.notices[0]!, calendar)).toBe('2025-10-06');
    const result = expandRules([rule], { start: '2025-10-01', end: '2025-10-31' }, {
      calendars: new Map([[calendar.id, calendar]]), fallbackCalendarId: calendar.id,
    });
    expect(result.occurrences.map((item) => [item.kind, item.date])).toEqual([['notice', '2025-10-06']]);
  });

  it('探索の先に長期休業があっても、その手前の本体の準備日を取りこぼさない', () => {
    const calendar = createBusinessDayCalendar({ ...createDefaultCalendars()[0]!,
      weekendDays: [], closedRanges: [{ from: '04-01', to: '06-30', label: '長期休業' }],
    }, createEmptyHolidayLookup());
    const rule = createRule({ title: '準備', recurrence: { type: 'monthlyByDay', interval: 1, months: [3], days: [20], overflow: 'clamp' },
      period: { start: '2026-03-20', end: '2026-03-20' }, adjust: { mode: 'none', keepInMonth: false },
      notices: [{ offset: -60, unit: 'business', label: '準備' }],
    });
    const result = expandRules([rule], { start: '2026-01-01', end: '2026-01-31' }, {
      calendars: new Map([[calendar.id, calendar]]), fallbackCalendarId: calendar.id,
    });
    expect(result.occurrences.map((item) => [item.kind, item.date])).toEqual([['notice', '2026-01-19']]);
  });

  it('臨時休業で補正なしから前倒しになってもICSのUIDは変わらない', () => {
    const rule = createRule({ title: '支払', recurrence: { type: 'monthlyByDay', interval: 1, days: [30], overflow: 'clamp' } });
    const uid = (closedDates: string[]): string[] => {
      const calendar = createBusinessDayCalendar({ ...createDefaultCalendars()[0]!, closedDates }, createEmptyHolidayLookup());
      const result = expandRules([rule], { start: '2026-11-01', end: '2026-11-30' }, {
        calendars: new Map([[calendar.id, calendar]]), fallbackCalendarId: calendar.id,
      });
      return buildIcs(result.occurrences, new Map([[rule.id, rule]]), { calendarName: 'test', includeNotices: true })
        .split('\r\n').filter((line) => line.startsWith('UID:'));
    };
    expect(uid([])).toEqual(uid(['2026-11-30']));
  });

  it('今年・翌年が欠けたデータを公開しない', () => {
    const data = buildHolidayData({ '2026-01-01': '元日' }, 'abc', new Date('2026-01-01'));
    expect(() => validatePublishedHolidays(data, 2026)).toThrow();
  });
});

describe('探索範囲は実際のカレンダーから求める', () => {
  /**
   * 2000-01-03 を起点に暦日へ換算していたため、対象年だけ臨時休業が多い
   * カレンダーでは足りず、年間の展開には出る準備日が月単位の展開では
   * 警告もなく消えていた。
   */
  const mondayOnly2026 = (): BusinessDayCalendar => {
    const closedDates: string[] = [];
    for (
      let date = '2026-01-01';
      date <= '2026-12-31';
      date = addDays(date, 1)
    ) {
      const day = weekdayOf(date);
      if (day >= 2 && day <= 5) closedDates.push(date);
    }
    return createBusinessDayCalendar(
      { ...companyCalendarDef, id: 'mon', closedRanges: [], closedDates },
      holidays,
    );
  };

  const rule = makeRule({
    id: 'r',
    title: '締め',
    calendarId: 'mon',
    recurrence: { type: 'monthlyByDay', interval: 1, days: [31], overflow: 'skip' },
    adjust: { mode: 'none', keepInMonth: false },
    period: { start: '2026-08-01', end: '2026-08-31' },
    notices: [{ id: 'n0', label: '準備', timing: { kind: 'offset', offset: -30, unit: 'business' } }],
  });

  const ctx = (): ScheduleContext => ({
    calendars: new Map([['mon', mondayOnly2026()]]),
    fallbackCalendarId: 'mon',
  });

  it('年間の結果を月で絞ったものと、月だけ計算したものが一致する', () => {
    const context = ctx();
    const year = expandRules([rule], { start: '2026-01-01', end: '2026-12-31' }, context)
      .occurrences.filter((o) => o.date >= '2026-01-01' && o.date <= '2026-01-31');
    const january = expandRules([rule], { start: '2026-01-01', end: '2026-01-31' }, context)
      .occurrences;

    expect(january).toEqual(year);
    // 実際に準備日が1件ある（両方とも空、では検査にならない）。
    expect(january.filter((o) => o.kind === 'notice')).toHaveLength(1);
  });
});

describe('前後予定の件数で探索範囲を膨らませない', () => {
  it('同じ設定を20件付けても、1件のときと同じ範囲', () => {
    // 足し合わせていたため6年先まで探索し、1か月の計算に約1秒かかっていた。
    // 入力のたびにプレビューを計算するので、編集の応答にも響く。
    const timing = { kind: 'offset', offset: -30, unit: 'business' } as const;
    const withCount = (count: number): Rule =>
      makeRule({
        id: 'r',
        notices: Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: 'x', timing })),
      });
    const range = { start: '2026-09-01', end: '2026-09-30' };

    expect(expandBoundsFor(withCount(20), range, companyCalendar)).toEqual(
      expandBoundsFor(withCount(1), range, companyCalendar),
    );
  });
});
