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

/** 1セルに並べるチップの上限。超えた分は「+N件」にまとめて詳細で開かせる。 */
export const MAX_CHIPS_PER_CELL = 3;

export type CalendarHandlers = {
  onSelectDay: (date: string) => void;
};

/** 補正の向きを示す記号。文字数を増やさずに前倒し・後ろ倒しを区別する。 */
const SHIFT_MARK = { prev: '←', next: '→' } as const;

/** セルの見た目を決めるクラス名を組み立てる。 */
function cellClassName(cell: DayCell, isSelected: boolean): string {
  const classes = ['cell'];
  if (!cell.inMonth) classes.push('is-outside');
  if (cell.isToday) classes.push('is-today');
  if (isSelected) classes.push('is-selected');
  if (cell.closedReason !== null) classes.push('is-closed');
  // 日曜と祝日は赤、土曜は青。祝日が土曜に重なった場合は祝日を優先する。
  if (cell.holidayName !== null || cell.weekday === 0) classes.push('is-red');
  else if (cell.weekday === 6) classes.push('is-blue');
  return classes.join(' ');
}

const dayOfDate = (date: string): string => String(Number(date.slice(8, 10)));

/** 予定チップに付ける補足説明（ツールチップ・スクリーンリーダー向け）。 */
export function occurrenceTitle(occurrence: Occurrence, rule: Rule): string {
  const lines = [rule.title, describeRule(rule)];
  if (occurrence.kind === 'notice') {
    lines.push(`${occurrence.noticeLabel ?? '事前通知'}（${occurrence.rawDate} の予定に対して）`);
  } else if (occurrence.shifted) {
    const direction = occurrence.shiftDirection === 'prev' ? '前営業日へ' : '翌営業日へ';
    lines.push(`本来は ${occurrence.rawDate}（休業日）。${direction}。`);
  }
  if (rule.note !== undefined && rule.note !== '') lines.push(rule.note);
  return lines.filter((line) => line !== '').join('\n');
}

function renderOccurrence(occurrence: Occurrence, rule: Rule): HTMLElement {
  const isNotice = occurrence.kind === 'notice';
  const label = isNotice ? `${rule.title}: ${occurrence.noticeLabel ?? '準備'}` : rule.title;

  // 補正済みは「←10」「→10」と出す。向きと、元がいつだったかの両方が2〜3文字で分かる。
  const mark =
    occurrence.shifted && occurrence.shiftDirection !== null
      ? h(
          'span',
          {
            class: `chip-mark is-${occurrence.shiftDirection}`,
            'aria-label': `${dayOfDate(occurrence.rawDate)}日から${
              occurrence.shiftDirection === 'prev' ? '前倒し' : '後ろ倒し'
            }`,
          },
          `${SHIFT_MARK[occurrence.shiftDirection]}${dayOfDate(occurrence.rawDate)}`,
        )
      : null;

  return h(
    'li',
    {
      class: `chip color-${rule.color}${isNotice ? ' is-notice' : ''}`,
      title: occurrenceTitle(occurrence, rule),
    },
    mark,
    h('span', { class: 'chip-label' }, label),
  );
}

function renderCell(
  cell: DayCell,
  rules: ReadonlyMap<string, Rule>,
  handlers: CalendarHandlers,
  selectedDate: string | null,
): HTMLElement {
  // 祝日名は休業理由より具体的なので優先して出す。
  // 年末年始休業と元日が重なる日に「年末年始休業」とだけ出ると情報が落ちるため。
  const closedLabel =
    cell.holidayName ??
    (cell.closedReason === null || cell.closedReason.kind === 'weekend'
      ? null
      : cell.closedReason.kind === 'closedDate'
        ? '臨時休業'
        : cell.closedReason.label);

  const visible = cell.occurrences
    .map((occurrence) => {
      const rule = rules.get(occurrence.ruleId);
      return rule === undefined ? null : { occurrence, rule };
    })
    .filter((entry): entry is { occurrence: Occurrence; rule: Rule } => entry !== null);

  const shown = visible.slice(0, MAX_CHIPS_PER_CELL);
  const hidden = visible.length - shown.length;

  const dayButton = h(
    'button',
    {
      type: 'button',
      class: 'cell-day',
      'aria-label': `${cell.date} の予定を見る`,
    },
    String(cell.day),
  );
  dayButton.addEventListener('click', () => handlers.onSelectDay(cell.date));

  const chips = shown.map(({ occurrence, rule }) => renderOccurrence(occurrence, rule));
  if (hidden > 0) {
    const more = h('button', { type: 'button', class: 'chip chip-more' }, `＋${hidden}件`);
    more.addEventListener('click', () => handlers.onSelectDay(cell.date));
    chips.push(h('li', { class: 'chip-more-item' }, more));
  }

  return h(
    'td',
    { class: cellClassName(cell, cell.date === selectedDate) },
    h(
      'div',
      { class: 'cell-head' },
      dayButton,
      closedLabel === null ? null : h('span', { class: 'cell-closed' }, closedLabel),
    ),
    chips.length === 0 ? null : h('ul', { class: 'chips' }, ...chips),
  );
}

export function renderCalendar(
  grid: MonthGrid,
  rules: ReadonlyMap<string, Rule>,
  handlers: CalendarHandlers,
  selectedDate: string | null = null,
): HTMLElement {
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
    ...grid.weeks.map((week) =>
      h('tr', {}, ...week.map((cell) => renderCell(cell, rules, handlers, selectedDate))),
    ),
  );

  return h(
    'table',
    { class: 'calendar', 'aria-label': `${grid.year}年${grid.month}月のカレンダー` },
    head,
    body,
  );
}

/** 凡例。記号の意味を説明する。 */
export function renderLegend(hasNotices: boolean, hasShifts: boolean): HTMLElement {
  return h(
    'p',
    { class: 'legend' },
    hasShifts
      ? h('span', {}, '← → = 休業日のため移動（数字は元の日）')
      : h('span', {}, '← → = 休業日のため前後の営業日へ移動'),
    hasNotices ? h('span', {}, '破線 = 事前通知') : null,
    h('span', {}, '日付をクリックすると当日の予定を一覧できます'),
  );
}
