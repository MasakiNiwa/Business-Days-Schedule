/**
 * 一覧表示（docs/SPEC.md §8.3）。
 *
 * カレンダーが「今月の形」を見るためのものなのに対し、こちらは
 * 「これから何が来るか」を時系列で追うためのもの。印刷して配る用途も想定する。
 */

import type { BusinessDayCalendar } from '../core/businessDay';
import { addDays, weekdayOf } from '../core/dateUtil';
import { describeRule, weekdayName } from '../core/describe';
import type { HolidayLookup } from '../core/holidays';
import type { BusinessCalendar, DateStr, Occurrence, Rule } from '../types';
import { h } from './dom';

/** 一覧で先読みできる日数の選択肢。 */
export const LIST_RANGES = [30, 90, 180, 365] as const;

const SHIFT_MARK = { prev: '←', next: '→' } as const;

export type ListHandlers = {
  onEditRule: (ruleId: string) => void;
  onSelectDay: (date: DateStr) => void;
};

const dayOfDate = (date: DateStr): string => String(Number(date.slice(8, 10)));

function weekdayClass(date: DateStr, holidays: HolidayLookup): string {
  if (holidays.nameOf(date) !== null || weekdayOf(date) === 0) return 'is-red';
  return weekdayOf(date) === 6 ? 'is-blue' : '';
}

function shiftCell(occurrence: Occurrence): HTMLElement | string {
  if (occurrence.kind === 'notice') {
    return h('span', { class: 'list-notice-origin' }, `${occurrence.rawDate} の準備`);
  }
  if (!occurrence.shifted || occurrence.shiftDirection === null) return '';
  return h(
    'span',
    { class: `chip-mark is-${occurrence.shiftDirection}` },
    `${SHIFT_MARK[occurrence.shiftDirection]}${dayOfDate(occurrence.rawDate)}`,
  );
}

function renderRow(
  occurrence: Occurrence,
  rule: Rule,
  calendars: ReadonlyMap<string, BusinessCalendar>,
  holidays: HolidayLookup,
  businessCalendar: BusinessDayCalendar,
  isFirstOfDate: boolean,
  today: DateStr,
  handlers: ListHandlers,
): HTMLElement {
  const date = occurrence.date;
  const classes = ['list-row'];
  if (isFirstOfDate) classes.push('is-group-start');
  if (date === today) classes.push('is-today');
  if (!businessCalendar.isBusinessDay(date)) classes.push('is-closed');

  const dateButton = h(
    'button',
    { type: 'button', class: 'list-date-button' },
    isFirstOfDate ? date : '',
  );
  dateButton.addEventListener('click', () => handlers.onSelectDay(date));

  const titleButton = h(
    'button',
    { type: 'button', class: 'list-title-button' },
    h('span', { class: `rule-dot color-${rule.color}`, 'aria-hidden': 'true' }),
    h(
      'span',
      { class: occurrence.kind === 'notice' ? 'is-notice-title' : '' },
      occurrence.kind === 'notice'
        ? `${rule.title}: ${occurrence.noticeLabel ?? '準備'}`
        : rule.title,
    ),
  );
  titleButton.addEventListener('click', () => handlers.onEditRule(rule.id));

  const holidayName = holidays.nameOf(date);
  const notes = [describeRule(rule)];
  const calendarName = calendars.get(rule.calendarId)?.name;
  if (calendarName !== undefined) notes.push(calendarName);
  if (rule.note !== undefined && rule.note !== '') notes.push(rule.note);

  return h(
    'tr',
    { class: classes.join(' ') },
    h('td', { class: 'list-date' }, dateButton),
    h(
      'td',
      { class: `list-weekday ${weekdayClass(date, holidays)}`.trim() },
      isFirstOfDate ? weekdayName(weekdayOf(date)) : '',
      isFirstOfDate && holidayName !== null
        ? h('span', { class: 'list-holiday' }, holidayName)
        : null,
    ),
    h('td', { class: 'list-title' }, titleButton),
    h('td', { class: 'list-shift' }, shiftCell(occurrence)),
    h('td', { class: 'list-note' }, notes.join(' / ')),
  );
}

export function renderList(
  occurrences: readonly Occurrence[],
  rules: ReadonlyMap<string, Rule>,
  calendars: ReadonlyMap<string, BusinessCalendar>,
  businessCalendar: BusinessDayCalendar,
  holidays: HolidayLookup,
  from: DateStr,
  days: number,
  today: DateStr,
  handlers: ListHandlers,
): HTMLElement {
  const to = addDays(from, days - 1);

  const section = h('section', { class: 'list-pane', 'aria-label': '予定の一覧' });
  section.append(
    h('p', { class: 'print-title' }, `${from} 〜 ${to} の予定`),
  );

  if (occurrences.length === 0) {
    section.append(
      h('p', { class: 'field-hint' }, `${from} 〜 ${to} に該当する予定はありません。`),
    );
    return section;
  }

  const rows: HTMLElement[] = [];
  let previousDate: DateStr | null = null;
  for (const occurrence of occurrences) {
    const rule = rules.get(occurrence.ruleId);
    if (rule === undefined) continue;
    rows.push(
      renderRow(
        occurrence,
        rule,
        calendars,
        holidays,
        businessCalendar,
        occurrence.date !== previousDate,
        today,
        handlers,
      ),
    );
    previousDate = occurrence.date;
  }

  section.append(
    h(
      'table',
      { class: 'list', 'aria-label': `${from} から ${to} までの予定` },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, '日付'),
          h('th', { scope: 'col' }, '曜日'),
          h('th', { scope: 'col' }, '予定'),
          h('th', { scope: 'col' }, '補正'),
          h('th', { scope: 'col' }, '内容'),
        ),
      ),
      h('tbody', {}, ...rows),
    ),
    h('p', { class: 'list-summary' }, `${occurrences.length} 件（${from} 〜 ${to}）`),
  );
  return section;
}
