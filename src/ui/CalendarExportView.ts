/**
 * 外部カレンダーへの書き出し画面（docs/SPEC.md §9.4）。
 *
 * 反復ルールは相手のカレンダーへ持ち込めないので、期間を切って
 * 確定済みの日付の集まりとして渡す。期間の指定が必須なのはそのため。
 */

import { addDays, todayInTokyo } from '../core/dateUtil';
import type { CalendarExportFormat } from '../core/exportCalendar';
import type { DateStr } from '../types';
import { button, checkbox, dateInput, field, select } from './controls';
import { clear, h } from './dom';

export type CalendarExportRequest = {
  from: DateStr;
  to: DateStr;
  format: CalendarExportFormat;
  includeNotices: boolean;
};

export type CalendarExportHandlers = {
  onExport: (request: CalendarExportRequest) => void;
  /** 期間が変わるたびに件数を数え直すために呼ぶ。 */
  countOccurrences: (from: DateStr, to: DateStr, includeNotices: boolean) => number;
  onClose: () => void;
};

const PRESETS: { label: string; days: number }[] = [
  { label: '3か月', days: 92 },
  { label: '6か月', days: 183 },
  { label: '1年', days: 365 },
  { label: '2年', days: 730 },
];

export function renderCalendarExport(
  handlers: CalendarExportHandlers,
  today: DateStr = todayInTokyo(),
): HTMLElement {
  const request: CalendarExportRequest = {
    from: today,
    to: addDays(today, 364),
    format: 'ics',
    includeNotices: true,
  };

  const summary = h('p', { class: 'export-summary' });
  const issues = h('div', { class: 'issues' });
  const fromInput = dateInput(request.from, (value) => {
    if (value !== null) request.from = value;
    refresh();
  });
  const toInput = dateInput(request.to, (value) => {
    if (value !== null) request.to = value;
    refresh();
  });

  const exportButton = h(
    'button',
    { type: 'button', class: 'button button-primary' },
    '書き出す',
  );
  exportButton.addEventListener('click', () => handlers.onExport({ ...request }));

  function refresh(): void {
    clear(issues);
    const valid = request.from <= request.to;
    exportButton.disabled = !valid;
    if (!valid) {
      issues.append(h('p', { class: 'issue issue-error' }, '開始日が終了日より後になっています'));
      summary.textContent = '';
      return;
    }
    const count = handlers.countOccurrences(request.from, request.to, request.includeNotices);
    summary.textContent = `${request.from} 〜 ${request.to} の ${count} 件を書き出します。`;
    if (count === 0) {
      issues.append(
        h('p', { class: 'issue issue-warning' }, 'この期間に該当する予定がありません。'),
      );
    }
  }

  const presets = h('div', { class: 'presets' });
  for (const preset of PRESETS) {
    presets.append(
      button(
        `今日から${preset.label}`,
        () => {
          request.from = today;
          request.to = addDays(today, preset.days - 1);
          fromInput.value = request.from;
          toInput.value = request.to;
          refresh();
        },
        'button button-sm button-quiet',
      ),
    );
  }

  const formatHint = h('p', { class: 'field-hint' });
  const setFormatHint = (): void => {
    formatHint.textContent =
      request.format === 'ics'
        ? 'iCalendar 形式。Google カレンダー・Outlook・Apple カレンダーのいずれでも取り込めます。迷ったらこちら。'
        : 'CSV 形式。Google カレンダーの取り込みと、表計算ソフトで中身を確かめたいとき向けです。Outlook.com では CSV の取り込みができないため、その場合は iCalendar を使ってください。';
  };
  setFormatHint();

  const section = h(
    'section',
    { class: 'export', 'aria-label': '外部カレンダーへの書き出し' },
    h('h2', { class: 'editor-title' }, '外部カレンダーへ書き出す'),
    h(
      'p',
      { class: 'field-hint' },
      '指定した期間の予定を、営業日補正を適用した日付で書き出します。繰り返しの設定そのものは渡らないため、期間が過ぎたら書き出し直してください。',
    ),
    field('形式', select(
      [
        { value: 'ics', label: 'iCalendar (.ics) — 推奨' },
        { value: 'csv', label: 'CSV (.csv) — Google カレンダー / 表計算' },
      ],
      request.format,
      (value) => {
        request.format = value;
        setFormatHint();
      },
    )),
    formatHint,
    field('期間', h('div', { class: 'row' }, fromInput, h('span', { class: 'unit' }, '〜'), toInput)),
    presets,
    checkbox('事前通知（準備日）も書き出す', request.includeNotices, (value) => {
      request.includeNotices = value;
      refresh();
    }),
    summary,
    issues,
    h(
      'div',
      { class: 'editor-actions' },
      exportButton,
      button('閉じる', () => handlers.onClose(), 'button'),
    ),
  );

  refresh();
  return section;
}
