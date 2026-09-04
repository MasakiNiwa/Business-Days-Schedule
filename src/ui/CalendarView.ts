/**
 * 月カレンダー表示（docs/SPEC.md §8.1, §8.2）。
 *
 * 月の格子は意味的に表なので <table> で組む。スクリーンリーダーと印刷の双方で
 * 素直に読めるようにするため。
 */

import type { DayCell, MonthGrid } from '../core/monthGrid';
import { describeRule, weekdayName } from '../core/describe';
import type { Occurrence, Rule } from '../types';
import { h } from './dom';

const WEEKDAY_HEADERS = [0, 1, 2, 3, 4, 5, 6] as const;

/** セルの見た目を決めるクラス名を組み立てる。 */
function cellClassName(cell: DayCell): string {
  const classes = ['cell'];
  if (!cell.inMonth) classes.push('is-outside');
  if (cell.isToday) classes.push('is-today');
  if (cell.closedReason !== null) classes.push('is-closed');
  // 日曜と祝日は赤、土曜は青。祝日が土曜に重なった場合は祝日を優先する。
  if (cell.holidayName !== null || cell.weekday === 0) classes.push('is-red');
  else if (cell.weekday === 6) classes.push('is-blue');
  return classes.join(' ');
}

/** 予定チップに付ける補足説明（ツールチップ・スクリーンリーダー向け）。 */
function occurrenceTitle(occurrence: Occurrence, rule: Rule): string {
  const lines = [rule.title, describeRule(rule)];
  if (occurrence.kind === 'notice') {
    lines.push(`${occurrence.noticeLabel ?? '事前通知'}（${occurrence.rawDate} の予定に対して）`);
  } else if (occurrence.shifted) {
    const direction = occurrence.shiftDirection === 'prev' ? '前倒し' : '後ろ倒し';
    lines.push(`本来は ${occurrence.rawDate}。休業日のため${direction}。`);
  }
  if (rule.note !== undefined && rule.note !== '') lines.push(rule.note);
  return lines.filter((line) => line !== '').join('\n');
}

function renderOccurrence(occurrence: Occurrence, rule: Rule): HTMLElement {
  const isNotice = occurrence.kind === 'notice';
  const label = isNotice
    ? `${rule.title}: ${occurrence.noticeLabel ?? '準備'}`
    : rule.title;

  return h(
    'li',
    {
      class: `chip color-${rule.color}${isNotice ? ' is-notice' : ''}`,
      title: occurrenceTitle(occurrence, rule),
    },
    // 補正済みであることを色だけに頼らず記号でも示す（§10.3 a11y）。
    occurrence.shifted ? h('span', { class: 'chip-mark', 'aria-label': '営業日補正あり' }, '⟳') : null,
    h('span', { class: 'chip-label' }, label),
  );
}

function renderCell(cell: DayCell, rules: ReadonlyMap<string, Rule>): HTMLElement {
  // 祝日名は休業理由より具体的なので優先して出す。
  // 年末年始休業と元日が重なる日に「年末年始休業」とだけ出ると情報が落ちるため。
  const closedLabel =
    cell.holidayName ??
    (cell.closedReason === null || cell.closedReason.kind === 'weekend'
      ? null
      : cell.closedReason.kind === 'closedDate'
        ? '臨時休業'
        : cell.closedReason.label);

  const chips = cell.occurrences
    .map((occurrence) => {
      const rule = rules.get(occurrence.ruleId);
      return rule === undefined ? null : renderOccurrence(occurrence, rule);
    })
    .filter((node): node is HTMLElement => node !== null);

  return h(
    'td',
    { class: cellClassName(cell) },
    h(
      'div',
      { class: 'cell-head' },
      h('span', { class: 'cell-day' }, String(cell.day)),
      closedLabel === null ? null : h('span', { class: 'cell-closed' }, closedLabel),
    ),
    chips.length === 0 ? null : h('ul', { class: 'chips' }, ...chips),
  );
}

export function renderCalendar(grid: MonthGrid, rules: ReadonlyMap<string, Rule>): HTMLElement {
  const head = h(
    'thead',
    {},
    h(
      'tr',
      {},
      ...WEEKDAY_HEADERS.map((weekday) =>
        h(
          'th',
          {
            scope: 'col',
            class: weekday === 0 ? 'is-red' : weekday === 6 ? 'is-blue' : '',
          },
          weekdayName(weekday),
        ),
      ),
    ),
  );

  const body = h(
    'tbody',
    {},
    ...grid.weeks.map((week) => h('tr', {}, ...week.map((cell) => renderCell(cell, rules)))),
  );

  return h(
    'table',
    {
      class: 'calendar',
      'aria-label': `${grid.year}年${grid.month}月のカレンダー`,
    },
    head,
    body,
  );
}

/** 凡例。事前通知の見え方を説明する。 */
export function renderLegend(hasNotices: boolean): HTMLElement {
  return h(
    'p',
    { class: 'legend' },
    h('span', {}, '⟳ = 休業日のため営業日へ補正'),
    hasNotices ? h('span', {}, '破線 = 事前通知') : null,
  );
}
