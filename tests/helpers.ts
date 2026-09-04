/**
 * テスト用のヘルパー。祝日データは tests/fixtures/holidays.json の
 * 固定スナップショット（2023-2027）を使い、外部取得に依存させない。
 */

import holidaysFixture from './fixtures/holidays.json' with { type: 'json' };
import { createBusinessDayCalendar, createDefaultCalendars } from '../src/core/businessDay';
import type { BusinessDayCalendar } from '../src/core/businessDay';
import { createHolidayLookup, parseHolidayData } from '../src/core/holidays';
import type { ScheduleContext } from '../src/core/schedule';
import { createRule } from '../src/core/storage';
import type { BusinessCalendar, Rule } from '../src/types';

export const holidays = createHolidayLookup(parseHolidayData(holidaysFixture));

export const [companyCalendarDef, bankCalendarDef] = createDefaultCalendars() as [
  BusinessCalendar,
  BusinessCalendar,
];

export function makeCalendar(overrides: Partial<BusinessCalendar> = {}): BusinessDayCalendar {
  return createBusinessDayCalendar({ ...companyCalendarDef, ...overrides }, holidays);
}

/** 年末年始休業を持たない、土日＋祝日だけの素朴なカレンダー。 */
export const plainCalendar = makeCalendar({ id: 'plain', closedRanges: [] });
export const companyCalendar = makeCalendar();
export const bankCalendar = createBusinessDayCalendar(bankCalendarDef, holidays);

export const scheduleContext: ScheduleContext = {
  calendars: new Map([
    ['company', companyCalendar],
    ['bank', bankCalendar],
    ['plain', plainCalendar],
  ]),
  fallbackCalendarId: 'company',
};

/** id と時刻を固定したルールを作る。テスト間で結果が揺れないようにする。 */
export function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    ...createRule(overrides),
    id: overrides.id ?? 'rule-test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
