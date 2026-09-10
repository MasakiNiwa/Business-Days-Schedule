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
import { button, checkbox, dateInput, field, named, select } from './controls';
import { clear, h } from './dom';

export type CalendarExportRequest = {
  from: DateStr;
  to: DateStr;
  format: CalendarExportFormat;
  /** 準備日（本体より前）も書き出すか。 */
  includeNotices: boolean;
  /** フォロー（本体より後）も書き出すか。 */
  includeFollows: boolean;
  /** 書き出す対象のグループ。null は「すべて」。 */
  /** 書き出すグループ。null は「すべて」。 */
  groups: string[] | null;
};

export type CalendarExportHandlers = {
  onExport: (request: CalendarExportRequest) => void;
  /** 期間・対象が変わるたびに件数を数え直すために呼ぶ。 */
  countOccurrences: (request: CalendarExportRequest) => number;
  onClose: () => void;
};

/** 選択肢の値として使う「すべて」。グループ名と衝突しない値を使う。 */

export type CalendarExportOptionsInput = {
  /** 選べるグループ名。空なら対象の選択欄そのものを出さない。 */
  groups: readonly string[];
  /** 未分類のルールがあるか。 */
  hasUngrouped: boolean;
  /** 画面で絞り込み中のグループ。初期値にする。 */
  activeGroups: string[] | null;
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

/**
 * 書き出す対象のグループ。複数選べる。
 *
 * 「税務」と「入金」だけをまとめて渡したい、のような使い方があるため。
 * 1つずつしか選べないと、そのたびに書き出し直すことになる。
 */
function buildGroupChoices(
  options: CalendarExportOptionsInput,
  draft: { groups: string[] | null },
  refresh: () => void,
): HTMLElement {
  const box = h('div', { class: 'group-choices', role: 'group', 'aria-label': '書き出すグループ' });

  const render = (): void => {
    clear(box);
    const selected = draft.groups;
    const chip = (label: string, pressed: boolean, onClick: () => void): HTMLElement => {
      const node = h(
        'button',
        { type: 'button', class: 'group-chip', 'aria-pressed': pressed ? 'true' : 'false' },
        label,
      );
      node.addEventListener('click', () => {
        onClick();
        render();
        refresh();
      });
      return node;
    };

    box.append(
      chip('すべて', selected === null, () => {
        draft.groups = null;
      }),
    );
    const names = [
      ...options.groups,
      ...(options.hasUngrouped ? [UNGROUPED] : []),
    ];
    for (const name of names) {
      box.append(
        chip(groupLabel(name), selected !== null && selected.includes(name), () => {
          // 「すべて」から1つ押したら、そのグループだけに絞る。
          const current = draft.groups;
          if (current === null) {
            draft.groups = [name];
            return;
          }
          const next = current.includes(name)
            ? current.filter((item) => item !== name)
            : [...current, name];
          draft.groups = next.length === 0 ? null : next;
        }),
      );
    }
  };
  render();
  return box;
}

export function renderCalendarExport(
  handlers: CalendarExportHandlers,
  today: DateStr = todayInTokyo(),
  options: CalendarExportOptionsInput = { groups: [], hasUngrouped: true, activeGroups: null },
): HTMLElement {
  const initial = monthRange(today, 0);
  // 日付は「未入力」を持てるようにする。欄を空にしたのに前の値で書き出せると、
  // 画面に出ていない期間を渡してしまう。
  const draft: {
    from: DateStr | null;
    to: DateStr | null;
    format: CalendarExportFormat;
    includeNotices: boolean;
    includeFollows: boolean;
    groups: string[] | null;
  } = {
    from: initial.from,
    to: initial.to,
    format: 'ics',
    includeNotices: true,
    includeFollows: true,
    // 絞り込んで見ていたなら、その束を渡したいはず。見ているものと渡すものが
    // 食い違うと、画面に無い予定が取り込み先へ紛れ込む。
    groups: options.activeGroups,
  };

  /** 入力がそろっているときだけ、実際の書き出し内容になる。 */
  const requestOf = (): CalendarExportRequest | null =>
    draft.from === null || draft.to === null || draft.from > draft.to
      ? null
      : { ...draft, from: draft.from, to: draft.to };

  const summary = h('p', { class: 'export-summary' });
  const issues = h('div', { class: 'issues' });
  const fromInput = named(
    dateInput(draft.from, (value) => {
      draft.from = value;
      refresh();
    }),
    '書き出す期間の開始日',
  );
  const toInput = named(
    dateInput(draft.to, (value) => {
      draft.to = value;
      refresh();
    }),
    '書き出す期間の終了日',
  );

  const exportButton = h(
    'button',
    { type: 'button', class: 'button button-primary' },
    '書き出す',
  );
  exportButton.addEventListener('click', () => {
    const request = requestOf();
    if (request !== null) handlers.onExport(request);
  });

  const presets = h('div', { class: 'presets', role: 'group', 'aria-label': 'よく使う期間' });
  const presetButtons = PRESETS.map((preset) => {
    const item = button(
      preset.label,
      () => {
        const range = preset.range(today);
        draft.from = range.from;
        draft.to = range.to;
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
      const selected = range.from === draft.from && range.to === draft.to;
      item.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }

    const request = requestOf();
    exportButton.disabled = request === null;
    if (request === null) {
      summary.textContent = '';
      if (draft.from === null || draft.to === null) {
        issues.append(
          h('p', { class: 'issue issue-error' }, '開始日と終了日の両方を入力してください'),
        );
      } else {
        issues.append(h('p', { class: 'issue issue-error' }, '開始日が終了日より後になっています'));
      }
      return;
    }
    const count = handlers.countOccurrences(request);
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
      draft.format === 'ics'
        ? 'iCalendar 形式。Google カレンダー・Outlook・Apple カレンダーのいずれでも取り込めます。迷ったらこちら。'
        : 'CSV 形式。Google カレンダーの取り込みと、表計算ソフトで中身を確かめたいとき向けです。Outlook.com では CSV の取り込みができないため、その場合は iCalendar を使ってください。';
  };
  setFormatHint();

  const section = h(
    'section',
    { class: 'export', 'aria-label': '外部カレンダーへの書き出し' },
    h('h2', { class: 'editor-title' }, '外部カレンダーへ書き出す'),
    // 押す前に必ず知っておいてほしいのは2つだけ。長い説明で設定欄を遠ざけない。
    // 手順は読みたい人だけが開けばよい（初回は開いた状態にしてある）。
    h(
      'div',
      { class: 'callout callout-warning' },
      h('p', { class: 'callout-title' }, '取り込み先は専用のカレンダーを作ってから'),
      h(
        'p',
        { class: 'callout-lead' },
        '自動では同期されません。書き出すのは指定期間の日付だけで、繰り返しの設定は渡りません。',
      ),
      h(
        'details',
        { class: 'export-howto', open: true },
        h('summary', {}, '専用カレンダーの作り方と、取り込んだあとの消し方'),
        h(
          'p',
          {},
          'いつもの予定表に直接入れると、あとで取り消したくなったときに一件ずつ消すことになります。Outlook なら「カレンダーの追加 → 空のカレンダーを作成」、Google カレンダーなら「他のカレンダー ＋ → 新しいカレンダーを作成」で入れ物を用意し、そこへ取り込むと丸ごと消せます。',
        ),
        h(
          'p',
          {},
          '期間が過ぎたら書き出し直してください。同じ予定は同じ識別子を持つので、取り込み先が対応していれば重複ではなく更新として扱われます。',
        ),
      ),
    ),
    options.groups.length === 0
      ? null
      : field(
          '対象',
          buildGroupChoices(options, draft, refresh),
          'グループごとに別々のカレンダーへ取り込めます。取り込み先で分けておくと、あとで束ごと消せます。複数選ぶと1つにまとめて書き出します。',
        ),
    field('期間', h('div', { class: 'row' }, fromInput, h('span', { class: 'unit' }, '〜'), toInput)),
    presets,
    field('形式', select(
      [
        { value: 'ics', label: 'iCalendar (.ics) — 推奨' },
        { value: 'csv', label: 'CSV (.csv) — Google カレンダー / 表計算' },
      ],
      draft.format,
      (value) => {
        draft.format = value;
        setFormatHint();
      },
    )),
    formatHint,
    // 前と後で要否が分かれることがあるので、まとめて1つにしない。
    h(
      'div',
      { class: 'field', role: 'group', 'aria-label': '本体に紐づく前後の予定' },
      h('span', { class: 'field-label' }, '前後の予定'),
      checkbox('準備日（本体より前）も書き出す', draft.includeNotices, (value) => {
        draft.includeNotices = value;
        refresh();
      }),
      checkbox('フォロー（本体より後）も書き出す', draft.includeFollows, (value) => {
        draft.includeFollows = value;
        refresh();
      }),
    ),
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
