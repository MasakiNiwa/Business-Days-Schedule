/**
 * 同梱サンプル（docs/SPEC.md §9.3）がそのまま取り込めることを保証する。
 * サンプルが壊れると初回起動の導線が死ぬため、CI で常に検証する。
 */

import { describe, expect, it } from 'vitest';
import sample from '../public/data/samples/business-basics.json' with { type: 'json' };
import { createBusinessDayCalendar } from '../src/core/businessDay';
import { expandRules } from '../src/core/schedule';
import type { ScheduleContext } from '../src/core/schedule';
import { createDefaultState, importState } from '../src/core/storage';
import { holidays } from './helpers';

describe('business-basics.json', () => {
  const result = importState(sample, createDefaultState(), 'replace');

  it('検証を通過し、1件も欠落しない', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toEqual({ rules: 0, calendars: 0 });
    expect(result.state.rules).toHaveLength(sample.rules.length);
  });

  it('取り込んだ状態で1年分を展開できる', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ctx: ScheduleContext = {
      calendars: new Map(
        result.state.calendars.map((calendar) => [
          calendar.id,
          createBusinessDayCalendar(calendar, holidays),
        ]),
      ),
      fallbackCalendarId: 'company',
    };
    const { occurrences, warnings } = expandRules(
      result.state.rules,
      { start: '2026-01-01', end: '2026-12-31' },
      ctx,
    );
    expect(warnings).toEqual([]);
    expect(occurrences.length).toBeGreaterThan(80);
    // すべての発生日が表示範囲に収まっている。
    for (const occurrence of occurrences) {
      expect(occurrence.date >= '2026-01-01' && occurrence.date <= '2026-12-31').toBe(true);
    }
  });
});
