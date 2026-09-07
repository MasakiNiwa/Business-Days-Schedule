/**
 * 外部カレンダーへの書き出し画面（docs/SPEC.md §9.4）。
 *
 * このアプリの値打ちは「反復ルールを組み立てること」にあり、日々見るのは
 * 会社で使っている Outlook や Google カレンダーであることが多い。
 * 反復ルールはそのまま持ち込めないので、期間を切って確定済みの日付の
 * 集まりとして渡す。期間の指定が必須なのはそのため。
 *
 * 初期値は「今月1日〜末日」。試しに押した1回で1年分がメインの予定表へ
 * 流れ込むと、消して回るのが大変で、取り返しもつきにくいため。
 */

import {
  addMonths,
  firstDateOfMonth,
  lastDateOfMonth,
  monthOf,
  todayInTokyo,
  yearOf,
} from '../core/dateUtil';
import type { CalendarExportFormat } from '../core/exportCalendar';
import { UNGROUPED, groupLabel } from '../core/group';
import type { DateStr } from '../types';
import { button, checkbox, dateInput, field, select } from './controls';
import { clear, h } from './dom';

export type CalendarExportRequest = {
  from: DateStr;
  to: DateStr;
  format: CalendarExportFormat;
  includeNotices: boolean;
  /** 書き出す対象のグループ。null は「すべて」。 */
  group: string | null;
};

export type CalendarExportHandlers = {
  onExport: (request: CalendarExportRequest) => void;
  /** 期間・対象が変わるたびに件数を数え直すために呼ぶ。 */
  countOccurrences: (request: CalendarExportRequest) => number;
  onClose: () => void;
};

/** 選択肢の値として使う「すべて」。グループ名と衝突しない値を使う。 */
const ALL_GROUPS = '\u0000all';

export type CalendarExportOptionsInput = {
  /** 選べるグループ名。空なら対象の選択欄そのものを出さない。 */
  groups: readonly string[];
  /** 未分類のルールがあるか。 */
  hasUngrouped: boolean;
  /** 画面で絞り込み中のグループ。初期値にする。 */
  activeGroup: string | null;
};

/** これを超えたら「多い」と伝える。取り込みは戻しにくいので、押す前に気づかせる。 */
const MANY_EVENTS = 60;

type Preset = { label: string; range: (today: DateStr) => { from: DateStr; to: DateStr } };

const monthRange = (today: DateStr, offset: number): { from: DateStr; to: DateStr } => {
  const target = addMonths(firstDateOfMonth(yearOf(today), monthOf(today)), offset);
  const year = yearOf(target);
  const month = monthOf(target);
  return { from: firstDateOfMonth(year, month), to: lastDateOfMonth(year, month) };
};

const spanFromThisMonth = (today: DateStr, months: number): { from: DateStr; to: DateStr } => ({
  from: monthRange(today, 0).from,
  to: monthRange(today, months - 1).to,
});

const PRESETS: Preset[] = [
  { label: '今月', range: (today) => monthRange(today, 0) },
  { label: '来月', range: (today) => monthRange(today, 1) },
  { label: '3か月', range: (today) => spanFromThisMonth(today, 3) },
  { label: '6か月', range: (today) => spanFromThisMonth(today, 6) },
  { label: '1年', range: (today) => spanFromThisMonth(today, 12) },
];

export function renderCalendarExport(
  handlers: CalendarExportHandlers,
  today: DateStr = todayInTokyo(),
  options: CalendarExportOptionsInput = { groups: [], hasUngrouped: true, activeGroup: null },
): HTMLElement {
  const initial = monthRange(today, 0);
  const request: CalendarExportRequest = {
    from: initial.from,
    to: initial.to,
    format: 'ics',
    includeNotices: true,
    // 絞り込んで見ていたなら、その束を渡したいはず。見ているものと渡すものが
    // 食い違うと、画面に無い予定が取り込み先へ紛れ込む。
    group: options.activeGroup,
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

  const presets = h('div', { class: 'presets', role: 'group', 'aria-label': 'よく使う期間' });
  const presetButtons = PRESETS.map((preset) => {
    const item = button(
      preset.label,
      () => {
        const range = preset.range(today);
        request.from = range.from;
        request.to = range.to;
        fromInput.value = range.from;
        toInput.value = range.to;
        refresh();
      },
      'button button-sm button-quiet',
    );
    presets.append(item);
    return { preset, item };
  });

  function refresh(): void {
    clear(issues);
    for (const { preset, item } of presetButtons) {
      const range = preset.range(today);
      const selected = range.from === request.from && range.to === request.to;
      item.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }

    const valid = request.from <= request.to;
    exportButton.disabled = !valid;
    if (!valid) {
      issues.append(h('p', { class: 'issue issue-error' }, '開始日が終了日より後になっています'));
      summary.textContent = '';
      return;
    }
    const count = handlers.countOccurrences({ ...request });
    summary.textContent = `${request.from} 〜 ${request.to} の ${count} 件を書き出します。`;
    if (count === 0) {
      issues.append(
        h('p', { class: 'issue issue-warning' }, 'この期間に該当する予定がありません。'),
      );
    } else if (count > MANY_EVENTS) {
      issues.append(
        h(
          'p',
          { class: 'issue issue-warning' },
          `${count} 件はかなりの数です。取り込んだあとに消して回るのは手間なので、まずは短い期間で試すことをおすすめします。`,
        ),
      );
    }
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
    // 取り込みは「元に戻す」が効かない操作なので、押す前に必ず目に入る位置へ置く。
    h(
      'div',
      { class: 'callout callout-warning' },
      h('p', { class: 'callout-title' }, '取り込み先は専用のカレンダーを作ってから'),
      h(
        'p',
        {},
        'いつもの予定表に直接入れると、あとで取り消したくなったときに一件ずつ消すことになります。Outlook なら「カレンダーの追加 → 空のカレンダーを作成」、Google カレンダーなら「他のカレンダー ＋ → 新しいカレンダーを作成」で入れ物を用意し、そこへ取り込むと丸ごと消せます。',
      ),
    ),
    options.groups.length === 0
      ? null
      : field(
          '対象',
          select(
            [
              { value: ALL_GROUPS, label: 'すべてのグループ' },
              ...options.groups.map((group) => ({ value: group, label: group })),
              ...(options.hasUngrouped
                ? [{ value: UNGROUPED, label: groupLabel(UNGROUPED) }]
                : []),
            ],
            request.group === null ? ALL_GROUPS : request.group,
            (value) => {
              request.group = value === ALL_GROUPS ? null : value;
              refresh();
            },
          ),
          'グループごとに別々のカレンダーへ取り込めます。取り込み先で分けておくと、あとで束ごと消せます。',
        ),
    field('期間', h('div', { class: 'row' }, fromInput, h('span', { class: 'unit' }, '〜'), toInput)),
    presets,
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
    checkbox('準備日も書き出す', request.includeNotices, (value) => {
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
