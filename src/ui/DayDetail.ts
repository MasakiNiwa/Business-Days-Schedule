/**
 * 日付を選んだときの詳細パネル。
 *
 * 1日に予定が集中するとセル内のチップだけでは読み切れないため、
 * その日に起きることを省略なしで並べる場所を用意する。
 */

import type { BusinessDayCalendar, ClosedReason } from '../core/businessDay';
import { describeRule, weekdayName } from '../core/describe';
import { weekdayOf } from '../core/dateUtil';
import type { HolidayLookup } from '../core/holidays';
import type { BusinessCalendar, DateStr, Occurrence, Rule } from '../types';
import { button } from './controls';
import { h } from './dom';

export type DayDetailHandlers = {
  onClose: () => void;
  onEditRule: (ruleId: string) => void;
  onMove: (days: number) => void;
};

function describeClosedReason(reason: ClosedReason | null): string {
  if (reason === null) return '営業日';
  switch (reason.kind) {
    case 'weekend':
      return '休業日（週末）';
    case 'holiday':
      return `休業日（${reason.label}）`;
    case 'closedRange':
      return `休業日（${reason.label}）`;
    case 'closedDate':
      return '休業日（臨時休業）';
  }
}

function renderOccurrence(
  occurrence: Occurrence,
  rule: Rule,
  calendars: ReadonlyMap<string, BusinessCalendar>,
  handlers: DayDetailHandlers,
): HTMLElement {
  const details: string[] = [describeRule(rule)];
  const calendarName = calendars.get(rule.calendarId)?.name;
  if (calendarName !== undefined) details.push(calendarName);

  const origin =
    occurrence.kind === 'notice'
      ? `${occurrence.rawDate} の予定に対する準備日`
      : occurrence.shifted
        ? `本来は ${occurrence.rawDate}（休業日）。${
            occurrence.shiftDirection === 'prev' ? '前営業日へ前倒し' : '翌営業日へ後ろ倒し'
          }。`
        : null;

  return h(
    'li',
    { class: `day-item${occurrence.kind === 'notice' ? ' is-notice' : ''}` },
    h('span', { class: `rule-dot color-${rule.color}`, 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'day-item-body' },
      h(
        'p',
        { class: 'day-item-title' },
        occurrence.kind === 'notice'
          ? `${rule.title}: ${occurrence.noticeLabel ?? '準備'}`
          : rule.title,
      ),
      origin === null ? null : h('p', { class: 'day-item-origin' }, origin),
      h('p', { class: 'day-item-desc' }, details.join(' / ')),
      rule.note === undefined || rule.note === ''
        ? null
        : h('p', { class: 'day-item-note' }, rule.note),
    ),
    button('編集', () => handlers.onEditRule(rule.id), 'button button-sm button-quiet'),
  );
}

export function renderDayDetail(
  date: DateStr,
  occurrences: readonly Occurrence[],
  rules: ReadonlyMap<string, Rule>,
  calendars: ReadonlyMap<string, BusinessCalendar>,
  businessCalendar: BusinessDayCalendar,
  holidays: HolidayLookup,
  handlers: DayDetailHandlers,
): HTMLElement {
  const holidayName = holidays.nameOf(date);
  const status = describeClosedReason(businessCalendar.closedReason(date));

  const prev = button('‹ 前日', () => handlers.onMove(-1), 'button button-sm button-quiet');
  const next = button('翌日 ›', () => handlers.onMove(1), 'button button-sm button-quiet');

  const section = h(
    'section',
    { class: 'day-detail', 'aria-label': `${date} の予定` },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', { class: 'editor-title' }, `${date}（${weekdayName(weekdayOf(date))}）`),
      h('div', { class: 'panel-actions' }, prev, next),
    ),
    h(
      'p',
      { class: 'day-status' },
      status,
      holidayName === null ? null : h('span', { class: 'day-holiday' }, holidayName),
    ),
  );

  if (occurrences.length === 0) {
    section.append(h('p', { class: 'field-hint' }, 'この日の予定はありません。'));
  } else {
    const items = occurrences
      .map((occurrence) => {
        const rule = rules.get(occurrence.ruleId);
        return rule === undefined
          ? null
          : renderOccurrence(occurrence, rule, calendars, handlers);
      })
      .filter((node): node is HTMLElement => node !== null);
    section.append(h('ul', { class: 'day-items' }, ...items));
  }

  section.append(
    h(
      'div',
      { class: 'editor-actions' },
      button('閉じる', () => handlers.onClose(), 'button button-primary'),
    ),
  );
  return section;
}
