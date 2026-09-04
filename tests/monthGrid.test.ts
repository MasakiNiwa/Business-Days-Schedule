import { describe, expect, it } from 'vitest';
import { buildMonthGrid, gridRangeOf, shiftMonth } from '../src/core/monthGrid';
import type { MonthGridContext } from '../src/core/monthGrid';
import { expandRules, groupByDate } from '../src/core/schedule';
import { companyCalendar, holidays, makeRule, scheduleContext } from './helpers';

const context = (overrides: Partial<MonthGridContext> = {}): MonthGridContext => ({
  calendar: companyCalendar,
  holidays,
  occurrencesByDate: new Map(),
  today: '2026-09-04',
  ...overrides,
});

describe('gridRangeOf', () => {
  it('日曜始まり・土曜終わりに広げる', () => {
    // 2026-09-01 は火曜、2026-09-30 は水曜。
    expect(gridRangeOf(2026, 9)).toEqual({ start: '2026-08-30', end: '2026-10-03' });
  });

  it('1日が日曜・末日が土曜の月は広げない', () => {
    // 2026-02-01(日) 〜 2026-02-28(土)
    expect(gridRangeOf(2026, 2)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
});

describe('buildMonthGrid', () => {
  it('7列の週に分割される', () => {
    const grid = buildMonthGrid(2026, 9, context());
    expect(grid.weeks).toHaveLength(5);
    for (const week of grid.weeks) expect(week).toHaveLength(7);
    expect(grid.weeks[0]?.[0]?.weekday).toBe(0);
    expect(grid.weeks.at(-1)?.at(-1)?.weekday).toBe(6);
  });

  it('前後の月の日は inMonth: false になる', () => {
    const grid = buildMonthGrid(2026, 9, context());
    const cells = grid.weeks.flat();
    expect(cells[0]).toMatchObject({ date: '2026-08-30', inMonth: false });
    expect(cells.find((c) => c.date === '2026-09-01')?.inMonth).toBe(true);
    expect(cells.find((c) => c.date === '2026-10-01')?.inMonth).toBe(false);
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30);
  });

  it('祝日名と休業理由を載せる', () => {
    const grid = buildMonthGrid(2026, 9, context());
    const cells = grid.weeks.flat();
    const respectForAged = cells.find((c) => c.date === '2026-09-21');
    expect(respectForAged?.holidayName).toBe('敬老の日');
    expect(respectForAged?.closedReason).toEqual({ kind: 'holiday', label: '敬老の日' });

    const saturday = cells.find((c) => c.date === '2026-09-05');
    expect(saturday?.closedReason).toEqual({ kind: 'weekend' });
    expect(saturday?.holidayName).toBeNull();

    const workday = cells.find((c) => c.date === '2026-09-04');
    expect(workday?.closedReason).toBeNull();
  });

  it('年末年始休業のラベルを載せる', () => {
    const grid = buildMonthGrid(2026, 12, context());
    const cell = grid.weeks.flat().find((c) => c.date === '2026-12-30');
    expect(cell?.closedReason).toEqual({ kind: 'closedRange', label: '年末年始休業' });
  });

  it('今日を印付ける', () => {
    const grid = buildMonthGrid(2026, 9, context({ today: '2026-09-04' }));
    const today = grid.weeks.flat().filter((c) => c.isToday);
    expect(today.map((c) => c.date)).toEqual(['2026-09-04']);
  });

  it('発生日をセルに割り当てる', () => {
    const rule = makeRule({
      id: 'salary',
      title: '給与振込',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
    });
    const { occurrences } = expandRules(
      [rule],
      { start: '2026-04-01', end: '2026-04-30' },
      scheduleContext,
    );
    const grid = buildMonthGrid(2026, 4, context({ occurrencesByDate: groupByDate(occurrences) }));
    const cell = grid.weeks.flat().find((c) => c.date === '2026-04-24');
    expect(cell?.occurrences).toHaveLength(1);
    expect(cell?.occurrences[0]).toMatchObject({ rawDate: '2026-04-25', shifted: true });
  });
});

describe('shiftMonth', () => {
  it('年をまたいで移動する', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 9, 0)).toEqual({ year: 2026, month: 9 });
    expect(shiftMonth(2026, 6, -18)).toEqual({ year: 2024, month: 12 });
  });
});
