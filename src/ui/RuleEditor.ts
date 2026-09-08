/**
 * ルール編集フォーム（docs/SPEC.md §8.4）。
 *
 * 中心は「次回以降の発生日プレビュー」。反復条件と営業日補正の組み合わせは
 * 頭の中で追いにくいため、入力するそばから実際の日付を見せることで誤設定を防ぐ。
 */

import { describeRule, describeTiming } from '../core/describe';
import { createNotice, roleOf, timingOf } from '../core/notice';
import { createRule } from '../core/storage';
import { todayInTokyo, weekdayOf } from '../core/dateUtil';
import { previewSeries } from '../core/schedule';
import type { ScheduleContext } from '../core/schedule';
import { validateRule } from '../core/validate';
import type {
  BusinessCalendar,
  ColorToken,
  DateStr,
  Month,
  NthWeekday,
  NoticeTiming,
  Recurrence,
  Rule,
  Weekday,
} from '../types';
import {
  button,
  checkbox,
  dateInput,
  field,
  named,
  numberInput,
  select,
  textInput,
  toggleGroup,
} from './controls';
import { clear, h } from './dom';

const PREVIEW_COUNT = 10;

const COLORS: ColorToken[] = ['blue', 'green', 'red', 'orange', 'purple', 'teal', 'pink', 'gray'];
const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const;

type RecurrenceKind = Recurrence['type'];

const KIND_LABELS: { value: RecurrenceKind; label: string }[] = [
  { value: 'monthlyByDay', label: '毎月N日' },
  { value: 'monthlyByBusinessDay', label: '第N営業日' },
  { value: 'monthlyByWeekday', label: '第N曜日' },
  { value: 'weekly', label: '毎週' },
  { value: 'fiscalRelative', label: '決算月基準' },
];

/** 決算月基準でよく使う形。数えるより選ぶほうが早い。 */
const FISCAL_PRESETS: { label: string; offsetMonths: number[]; day: number | 'last' }[] = [
  { label: '決算日', offsetMonths: [0], day: 'last' },
  { label: '申告期限（2か月後の末日）', offsetMonths: [2], day: 'last' },
  { label: '期首（翌月1日）', offsetMonths: [1], day: 1 },
  { label: '中間申告（8か月後の末日）', offsetMonths: [8], day: 'last' },
  { label: '四半期末', offsetMonths: [-9, -6, -3, 0], day: 'last' },
];

/** 種類を切り替えても入力を失わないよう、種類ごとの下書きを持つ。 */
function defaultDrafts(current: Recurrence): Record<RecurrenceKind, Recurrence> {
  const drafts: Record<RecurrenceKind, Recurrence> = {
    weekly: { type: 'weekly', interval: 1, weekdays: [1] },
    monthlyByDay: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
    monthlyByWeekday: { type: 'monthlyByWeekday', interval: 1, nth: [1], weekday: 2 },
    monthlyByBusinessDay: { type: 'monthlyByBusinessDay', interval: 1, nth: [5] },
    fiscalRelative: { type: 'fiscalRelative', offsetMonths: [2], day: 'last' },
  };
  drafts[current.type] = current;
  return drafts;
}

export type RuleEditorHandlers = {
  onSave: (rule: Rule) => void;
  onCancel: () => void;
  onDelete?: (ruleId: string) => void;
};

/** グループ名の入力候補。id は datalist と結ぶために使う。 */
const GROUP_LIST_ID = 'rule-group-options';

/** 「どの週か」の選択肢。実務で使う範囲に絞る。 */
const WEEK_OPTIONS = [
  { value: '-2', label: '前々週' },
  { value: '-1', label: '前週' },
  { value: '0', label: '同じ週' },
  { value: '1', label: '翌週' },
  { value: '2', label: '翌々週' },
];

/** 前後予定の小さな入力欄。画面に見えるラベルを必ず付ける。 */
function subField(labelText: string, control: HTMLElement): HTMLElement {
  const element = field(labelText, control);
  element.classList.add('field-compact');
  return element;
}

/** 「どの月か」の選択肢。 */
const MONTH_OPTIONS = [
  { value: '-1', label: '前月' },
  { value: '0', label: '同じ月' },
  { value: '1', label: '翌月' },
  { value: '2', label: '2か月後' },
  { value: '3', label: '3か月後' },
];

const TIMING_KIND_OPTIONS = [
  { value: 'offset' as const, label: '日数で指定' },
  { value: 'weekday' as const, label: '週と曜日で指定' },
  { value: 'monthlyBusinessDay' as const, label: '月と第N営業日で指定' },
];

const UNIT_OPTIONS = [
  { value: 'business' as const, label: '営業日' },
  { value: 'calendar' as const, label: '暦日' },
];

const ROLE_OPTIONS = [
  { value: 'before' as const, label: '前（準備）' },
  { value: 'after' as const, label: '後（フォロー）' },
];

const ON_CLOSED_OPTIONS = [
  { value: 'next' as const, label: '翌営業日へ送る' },
  { value: 'prev' as const, label: '前営業日へ戻す' },
  { value: 'none' as const, label: 'その日のまま' },
];

/** 月末からの指定に負の数を使わせない。繰り返し設定と同じ言い回しに揃える。 */
const NTH_ORIGIN_OPTIONS = [
  { value: 'start' as const, label: '月初から' },
  { value: 'end' as const, label: '月末から' },
];

/** 決め方を切り替えたときの初期値。役割（前・後）に近い形から始める。 */
function defaultTimingFor(kind: NoticeTiming['kind'], role: 'before' | 'after'): NoticeTiming {
  switch (kind) {
    case 'offset':
      return { kind: 'offset', offset: role === 'before' ? -3 : 3, unit: 'business' };
    case 'weekday':
      return { kind: 'weekday', weeks: role === 'before' ? -1 : 1, weekday: 3, onClosed: 'next' };
    case 'monthlyBusinessDay':
      return { kind: 'monthlyBusinessDay', months: role === 'before' ? 0 : 1, nth: 5 };
  }
}

export class RuleEditor {
  readonly element: HTMLFormElement;

  private draft: Rule;
  private readonly drafts: Record<RecurrenceKind, Recurrence>;
  private readonly recurrenceBody = h('div', { class: 'recurrence-body' });
  /** 「→ 本体の3営業日前」の行。作り直さずに文字だけ替えるため持っておく。 */
  private noticeHints: HTMLElement[] = [];
  /**
   * 前後予定ごと・決め方ごとの編集値。決め方を切り替えて戻したときに、
   * さっきまで入れていた値を初期値で上書きしないため。
   */
  private readonly timingDrafts = new Map<string, Partial<Record<NoticeTiming['kind'], NoticeTiming>>>();
  private readonly previewBody = h('div', { class: 'preview-body' });
  private readonly issuesBody = h('div', { class: 'issues' });
  private readonly summaryBody = h('p', { class: 'rule-summary' });
  private readonly nextDates = h('p', { class: 'next-dates' });
  private showPresets = true;
  private adjustControls: HTMLElement | null = null;
  private adjustInapplicable: HTMLElement | null = null;
  private readonly today: DateStr;

  constructor(
    initial: Rule,
    private readonly calendars: readonly BusinessCalendar[],
    private readonly ctx: ScheduleContext,
    private readonly handlers: RuleEditorHandlers,
    private readonly isNew: boolean,
    today: DateStr = todayInTokyo(),
    /** すでに使われているグループ名。入力候補として出す。 */
    private readonly knownGroups: readonly string[] = [],
  ) {
    this.draft = structuredClone(initial);
    this.drafts = defaultDrafts(this.draft.recurrence);
    this.today = today;
    this.element = this.build();
    this.renderRecurrence();
    this.refresh();
  }

  // -------------------------------------------------------------------------
  // 組み立て
  // -------------------------------------------------------------------------

  private build(): HTMLFormElement {
    const form = h('form', { class: 'editor', novalidate: true });

    form.append(
      h('h2', { class: 'editor-title' }, this.isNew ? 'ルールを追加' : 'ルールを編集'),
      ...(this.isNew && this.showPresets ? [this.buildPresets()] : []),
      this.buildBasics(),
      this.buildRecurrence(),
      this.buildAdjust(),
      // 前後の予定は使わない人のほうが多い。既定では畳んで、いつ行うかを
      // 決め終えるまでの道のりを短くする。既に付けてあるなら開いて出す。
      h('details', { class: 'advanced-options', open: this.draft.notices.length > 0 },
        h('summary', {}, '3. 準備や確認の予定を付ける（任意）'), this.buildNotices()),
      h('details', { class: 'advanced-options', open: !this.isNew || this.draft.period.start !== null || this.draft.skipDates.length > 0 },
        h('summary', {}, '詳細設定（期間・除外日）'), this.buildPeriod(), this.buildSkipDates()),
      h('details', { class: 'advanced-options' }, h('summary', {}, '次の10回をすべて見る'), this.buildPreview()),
      h('div', { class: 'editor-review' }, this.summaryBody, this.nextDates, this.issuesBody, this.buildActions()),
    );

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.save();
    });
    return form;
  }

  private buildPresets(): HTMLElement {
    const presets: { label: string; title: string; bank?: boolean; recurrence: Recurrence }[] = [
      { label: '給与', title: '給与振込', bank: true, recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' } },
      { label: '支払', title: '支払', bank: true, recurrence: { type: 'monthlyByDay', interval: 1, days: ['last'], overflow: 'clamp' } },
      { label: '締め日', title: '月次締め', recurrence: { type: 'monthlyByDay', interval: 1, days: ['last'], overflow: 'clamp' } },
      { label: '会議', title: '定例会議', recurrence: { type: 'weekly', interval: 1, weekdays: [1] } },
      { label: '自由入力', title: '', recurrence: { type: 'monthlyByDay', interval: 1, days: [1], overflow: 'clamp' } },
    ];
    return h('section', { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, '何の予定を作りますか？'),
      h('p', { class: 'field-hint' }, 'ひな型を選び、日付を自社の運用に合わせて直してください。'),
      h('div', { class: 'presets' }, ...presets.map((preset) => button(preset.label, () => {
        const calendarId = this.calendars.find((calendar) => calendar.id === (preset.bank ? 'bank' : 'company'))?.id ?? this.calendars[0]?.id ?? this.draft.calendarId;
        // ひな型は繰り返しの形だけを差し替える。作りかけで決まっているもの
        // （グループ）まで消すと、絞り込み中に作った予定が保存直後に画面から
        // 消えて戸惑わせる。
        const group = this.draft.group;
        this.draft = createRule({ title: preset.title, recurrence: structuredClone(preset.recurrence), calendarId,
          adjust: { mode: preset.label === '会議' || preset.label === '自由入力' ? 'none' : 'prev', keepInMonth: false },
          ...(group === undefined || group === '' ? {} : { group }) });
        Object.assign(this.drafts, defaultDrafts(this.draft.recurrence));
        this.showPresets = false;
        const form = this.build();
        this.element.replaceChildren(...form.childNodes);
        this.renderRecurrence();
        this.refresh();
        this.element.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
      }, 'button'))));
  }

  private buildBasics(): HTMLElement {
    const title = textInput(this.draft.title, (value) => {
      this.draft.title = value;
      this.refresh();
    }, '例: 給与振込');

    // グループは選ぶことも新しく作ることもあるので、候補付きの自由入力にする。
    // 選択肢だけにすると最初の1つを作れず、自由入力だけだと表記が揺れる。
    const group = textInput(this.draft.group ?? '', (value) => {
      this.draft.group = value;
      this.refresh();
    }, '例: 税務');
    group.setAttribute('list', GROUP_LIST_ID);
    const groupOptions = h('datalist', { id: GROUP_LIST_ID });
    for (const name of this.knownGroups) groupOptions.append(h('option', { value: name }));

    const colorRow = h('div', { class: 'colors' });
    for (const color of COLORS) {
      const swatch = h('button', {
        type: 'button',
        class: `swatch color-${color}`,
        'aria-label': color,
        'aria-pressed': this.draft.color === color ? 'true' : 'false',
      });
      swatch.addEventListener('click', () => {
        this.draft.color = color;
        for (const other of colorRow.querySelectorAll('.swatch')) {
          other.setAttribute('aria-pressed', other === swatch ? 'true' : 'false');
        }
      });
      colorRow.append(swatch);
    }

    return h(
      'section',
      { class: 'editor-section' },
      // どこまで進んだかが分かるよう、常に出る節に番号を振る。
      // ひな型は近道であって手順の1つではないので、番号を持たせない。
      h('h3', { class: 'editor-heading' }, '1. 何の予定ですか？'),
      field('タイトル', title),
      field(
        '営業日カレンダー',
        select(
          this.calendars.map((calendar) => ({ value: calendar.id, label: calendar.name })),
          this.draft.calendarId,
          (value) => {
            this.draft.calendarId = value;
            this.refresh();
          },
        ),
        '社内の締めは自社、振込は銀行、のように使い分けます。',
      ),
      field(
        'グループ',
        h('div', { class: 'row' }, group, groupOptions),
        'カレンダーの絞り込みと、外部カレンダーへの書き出しの単位になります。空欄なら未分類です。',
      ),
      h('details', { class: 'advanced-options', open: !this.isNew },
      h('summary', {}, '色・メモ・有効／無効'), field('色', colorRow), field(
        'メモ',
        textInput(this.draft.note ?? '', (value) => {
          this.draft.note = value;
        }, '任意'),
      ),
      checkbox('このルールを有効にする', this.draft.enabled, (value) => {
        this.draft.enabled = value;
      })),
    );
  }

  private buildRecurrence(): HTMLElement {
    const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': '繰り返しの種類' });
    for (const kind of KIND_LABELS) {
      const tab = h(
        'button',
        {
          type: 'button',
          class: 'tab',
          'aria-pressed': this.draft.recurrence.type === kind.value ? 'true' : 'false',
        },
        kind.label,
      );
      tab.addEventListener('click', () => {
        this.drafts[this.draft.recurrence.type] = this.draft.recurrence;
        this.draft.recurrence = this.drafts[kind.value];
        for (const other of tabs.querySelectorAll('.tab')) {
          other.setAttribute('aria-pressed', other === tab ? 'true' : 'false');
        }
        this.renderRecurrence();
        this.syncAdjustVisibility();
        this.refresh();
      });
      tabs.append(tab);
    }

    return h(
      'section',
      { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, '2. いつ行いますか？（繰り返し）'),
      tabs,
      this.recurrenceBody,
    );
  }

  /** 種類ごとの入力欄を描き直す。 */
  private renderRecurrence(): void {
    clear(this.recurrenceBody);
    const recurrence = this.draft.recurrence;
    switch (recurrence.type) {
      case 'weekly':
        this.recurrenceBody.append(...this.weeklyFields(recurrence));
        break;
      case 'monthlyByDay':
        this.recurrenceBody.append(...this.monthlyByDayFields(recurrence));
        break;
      case 'monthlyByWeekday':
        this.recurrenceBody.append(...this.monthlyByWeekdayFields(recurrence));
        break;
      case 'monthlyByBusinessDay':
        this.recurrenceBody.append(...this.monthlyByBusinessDayFields(recurrence));
        break;
      case 'fiscalRelative':
        this.recurrenceBody.append(...this.fiscalRelativeFields(recurrence));
        break;
    }
  }

  /** 決算月基準（§5.2 (e)）。決算月そのものは営業日カレンダーの設定から取る。 */
  private fiscalRelativeFields(
    recurrence: Recurrence & { type: 'fiscalRelative' },
  ): HTMLElement[] {
    const container = h('div', {});

    const render = (): void => {
      clear(container);

      const presets = h('div', { class: 'presets' });
      for (const preset of FISCAL_PRESETS) {
        presets.append(
          button(
            preset.label,
            () => {
              recurrence.offsetMonths = [...preset.offsetMonths];
              recurrence.day = preset.day;
              render();
              this.refresh();
            },
            'button button-sm button-quiet',
          ),
        );
      }

      const rows = h('div', { class: 'rows' });
      recurrence.offsetMonths.forEach((offset, index) => {
        rows.append(
          h(
            'div',
            { class: 'row' },
            h('span', { class: 'unit' }, '決算月の'),
            named(
              numberInput(
                offset,
                (value) => {
                  recurrence.offsetMonths[index] = Math.round(value);
                  this.refresh();
                },
                { min: -24, max: 24 },
              ),
              `${index + 1} 件目の決算月からのずれ（か月）`,
            ),
            h('span', { class: 'unit' }, 'か月後'),
            button(
              '削除',
              () => {
                recurrence.offsetMonths.splice(index, 1);
                render();
                this.refresh();
              },
              'button button-sm button-quiet',
            ),
          ),
        );
      });
      rows.append(
        button(
          '＋ 追加',
          () => {
            recurrence.offsetMonths.push(0);
            render();
            this.refresh();
          },
          'button button-sm',
        ),
      );

      container.append(presets, rows);
    };
    render();

    const dayOptions = [
      { value: 'last', label: '末日' },
      ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}日` })),
    ];

    const fiscalMonth = this.calendars.find(
      (calendar) => calendar.id === this.draft.calendarId,
    )?.fiscalYearEndMonth;

    return [
      field(
        'ずれ',
        container,
        'マイナスにすると決算月より前になります。四半期のように複数指定もできます。',
      ),
      field(
        '日',
        select(dayOptions, recurrence.day === 'last' ? 'last' : String(recurrence.day), (value) => {
          recurrence.day = value === 'last' ? 'last' : Number(value);
          this.refresh();
        }),
      ),
      h(
        'p',
        { class: 'field-hint' },
        `決算月は営業日カレンダーの設定を使います（現在: ${fiscalMonth ?? 3}月）。設定を変えると、このルールの日付もまとめて動きます。`,
      ),
    ];
  }

  private weeklyFields(recurrence: Recurrence & { type: 'weekly' }): HTMLElement[] {
    const anchorField = field(
      '基準日',
      dateInput(recurrence.anchor ?? this.draft.period.start, (value) => {
        if (value === null) delete recurrence.anchor;
        else recurrence.anchor = value;
        this.refresh();
      }),
      'この日を含む週から数えます。隔週の位相がずれるときに指定してください。',
    );
    anchorField.hidden = recurrence.interval < 2;

    return [
      field(
        '曜日',
        toggleGroup(
          WEEKDAY_NAMES.map((label, index) => ({ value: index as Weekday, label })),
          recurrence.weekdays,
          (next) => {
            recurrence.weekdays = next;
            this.refresh();
          },
        ),
      ),
      field(
        '間隔',
        h(
          'div',
          { class: 'inline' },
          numberInput(recurrence.interval, (value) => {
            recurrence.interval = value;
            anchorField.hidden = value < 2;
            this.refresh();
          }, { min: 1, max: 52 }),
          h('span', { class: 'unit' }, '週ごと'),
        ),
        '1 = 毎週、2 = 隔週。',
      ),
      anchorField,
    ];
  }

  private monthlyByDayFields(recurrence: Recurrence & { type: 'monthlyByDay' }): HTMLElement[] {
    // 「31日」と「末日」は分けない。31日を指定した月はすべて末日なので、
    // 2つ並べても選ぶ側が迷うだけになる。内部表現は 'last' に寄せる。
    const dayOptions = [
      ...Array.from({ length: 30 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
      { value: 'last', label: '31 / 末日', className: 'is-wide' },
    ];
    // 以前の版で保存された 31 も「31 / 末日」として扱う。
    const selectedDays = [
      ...new Set(
        recurrence.days.map((day) => (day === 'last' || day === 31 ? 'last' : String(day))),
      ),
    ];

    const overflowField = field(
      '2月に無い日の扱い',
      select(
        [
          { value: 'clamp', label: 'その月の末日に丸める' },
          { value: 'skip', label: 'その月は実行しない' },
        ],
        recurrence.overflow,
        (value) => {
          recurrence.overflow = value;
          this.refresh();
        },
      ),
      '29日・30日を指定したときの2月の扱いです。',
    );
    // 29日・30日を選んでいるときだけ問う。それ以外では起こり得ない選択なので出さない。
    const needsOverflow = (days: readonly (number | 'last')[]): boolean =>
      days.some((day) => day === 29 || day === 30);
    overflowField.hidden = !needsOverflow(recurrence.days);

    return [
      field(
        '日',
        toggleGroup(
          dayOptions,
          selectedDays,
          (next) => {
            recurrence.days = next.map((value) => (value === 'last' ? 'last' : Number(value)));
            overflowField.hidden = !needsOverflow(recurrence.days);
            this.refresh();
          },
          'toggles-days',
        ),
        '複数選べます（例: 10日と25日）。',
      ),
      overflowField,
      this.monthsField(recurrence),
    ];
  }

  private monthlyByWeekdayFields(
    recurrence: Recurrence & { type: 'monthlyByWeekday' },
  ): HTMLElement[] {
    return [
      field(
        '第N週',
        toggleGroup(
          [
            { value: 1, label: '第1' },
            { value: 2, label: '第2' },
            { value: 3, label: '第3' },
            { value: 4, label: '第4' },
            { value: 5, label: '第5' },
            { value: -1, label: '最終' },
          ],
          recurrence.nth,
          (next) => {
            recurrence.nth = next as NthWeekday[];
            this.refresh();
          },
        ),
        '第5週が無い月は実行されません。毎月確実に行うなら「最終」を選びます。',
      ),
      field(
        '曜日',
        select(
          WEEKDAY_NAMES.map((label, index) => ({ value: String(index), label: `${label}曜` })),
          String(recurrence.weekday),
          (value) => {
            recurrence.weekday = Number(value) as Weekday;
            this.refresh();
          },
        ),
      ),
      this.monthsField(recurrence),
    ];
  }

  private monthlyByBusinessDayFields(
    recurrence: Recurrence & { type: 'monthlyByBusinessDay' },
  ): HTMLElement[] {
    const list = h('div', { class: 'rows' });

    const renderRows = (): void => {
      clear(list);
      recurrence.nth.forEach((nth, index) => {
        const fromEnd = nth < 0;
        const row = h(
          'div',
          { class: 'row' },
          named(
            select(
              [
                { value: 'start', label: '月初から' },
                { value: 'end', label: '月末から' },
              ],
              fromEnd ? 'end' : 'start',
              (value) => {
                const magnitude = Math.abs(recurrence.nth[index] ?? 1);
                recurrence.nth[index] = value === 'end' ? -magnitude : magnitude;
                renderRows();
                this.refresh();
              },
            ),
            `${index + 1} 件目の起点`,
          ),
          named(
            // 入力された数をそのまま持つ。0 を 1 に直して黙って保存すると、
            // 画面に出ている数と保存される数が食い違う。検証で弾く。
            numberInput(Math.abs(nth), (value) => {
              recurrence.nth[index] = fromEnd ? -value : value;
              this.refresh();
            }, { min: 1, max: 31 }),
            `${index + 1} 件目の営業日数`,
          ),
          h('span', { class: 'unit' }, fromEnd ? '営業日前' : '営業日目'),
          button(
            '削除',
            () => {
              recurrence.nth.splice(index, 1);
              renderRows();
              this.refresh();
            },
            'button button-sm button-quiet',
          ),
        );
        list.append(row);
      });
      list.append(
        button(
          '＋ 追加',
          () => {
            recurrence.nth.push(1);
            renderRows();
            this.refresh();
          },
          'button button-sm',
        ),
      );
    };
    renderRows();

    return [
      field(
        '営業日',
        list,
        '「月末から2営業日前」は月末営業日の2つ前です。この指定はすでに営業日なので補正されません。',
      ),
      this.monthsField(recurrence),
    ];
  }

  /** 対象月の選択。1つだけ選べば年次、4つ選べば四半期になる。 */
  private monthsField(
    recurrence: Recurrence & { months?: Month[] },
  ): HTMLElement {
    const container = h('div', {});

    const render = (): void => {
      clear(container);
      const selected = recurrence.months ?? [];
      const presets = h(
        'div',
        { class: 'presets' },
        button('毎月', () => {
          delete recurrence.months;
          render();
          this.refresh();
        }, 'button button-sm button-quiet'),
        button('四半期 (3・6・9・12月)', () => {
          recurrence.months = [3, 6, 9, 12];
          render();
          this.refresh();
        }, 'button button-sm button-quiet'),
        button('半期 (3・9月)', () => {
          recurrence.months = [3, 9];
          render();
          this.refresh();
        }, 'button button-sm button-quiet'),
      );

      container.append(
        presets,
        toggleGroup(
          Array.from({ length: 12 }, (_, i) => ({ value: (i + 1) as Month, label: String(i + 1) })),
          selected,
          (next) => {
            if (next.length === 0 || next.length === 12) delete recurrence.months;
            else recurrence.months = next;
            this.refresh();
          },
          'toggles-months',
        ),
      );
    };
    render();

    return h('details', { class: 'advanced-options', open: Boolean(recurrence.months?.length) },
      h('summary', {}, '対象月を限定する（通常は毎月）'),
      field('対象月', container, '何も選ばなければ毎月。1つだけ選ぶと年次になります。'));
  }

  /** 第N営業日は定義上すでに営業日なので、補正の設定自体を持たせない。 */
  private adjustApplies(): boolean {
    return this.draft.recurrence.type !== 'monthlyByBusinessDay';
  }

  private buildAdjust(): HTMLElement {
    const keepInMonth = checkbox(
      '補正で月をまたがない（またぐ場合は逆方向へ）',
      this.draft.adjust.keepInMonth,
      (value) => {
        this.draft.adjust.keepInMonth = value;
        this.refresh();
      },
    );

    const modeSelect = select(
      [
        { value: 'prev', label: '前営業日へ（前倒し）' },
        { value: 'next', label: '翌営業日へ（後ろ倒し）' },
        { value: 'both', label: '前後の営業日の両方へ' },
        { value: 'nearest', label: '近い方の営業日へ' },
        { value: 'none', label: '補正しない' },
      ],
      this.draft.adjust.mode,
      (value) => {
        this.draft.adjust.mode = value;
        keepInMonth.hidden = value === 'none';
        this.refresh();
      },
    );
    keepInMonth.hidden = this.draft.adjust.mode === 'none';

    const inapplicable = h(
      'p',
      { class: 'field-hint' },
      '「第N営業日」は常に営業日のため、補正の設定はありません。',
    );

    const controls = h(
      'div',
      { class: 'adjust-controls' },
      field(
        '休業日の場合',
        modeSelect,
        '「前後の営業日の両方へ」は、取引先ごとに前倒し・後ろ倒しが分かれるときに使います。1つの基準日から前後2件が表示されます。',
      ),
      keepInMonth,
    );

    const section = h(
      'section',
      { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, '休業日にあたったとき'),
      controls,
      inapplicable,
    );

    this.adjustControls = controls;
    this.adjustInapplicable = inapplicable;
    this.syncAdjustVisibility();
    return section;
  }

  /**
   * 補正欄の出し分け。効かない設定を触れる状態で置くと、保存された値と
   * 実際の計算が食い違う。隠すだけでなく値も none に正規化する。
   */
  private syncAdjustVisibility(): void {
    const applies = this.adjustApplies();
    if (this.adjustControls !== null) this.adjustControls.hidden = !applies;
    if (this.adjustInapplicable !== null) this.adjustInapplicable.hidden = applies;
    if (!applies && this.draft.adjust.mode !== 'none') {
      this.draft.adjust = { mode: 'none', keepInMonth: false };
      const modeSelect = this.adjustControls?.querySelector('select');
      if (modeSelect) modeSelect.value = 'none';
      const keepInMonth = this.adjustControls?.querySelector<HTMLElement>('.checkbox');
      if (keepInMonth) keepInMonth.hidden = true;
      const checkbox = keepInMonth?.querySelector('input');
      if (checkbox) checkbox.checked = false;
    }
  }

  /**
   * 前後の予定の編集。
   *
   * 入力欄の値と保存される値は必ず一致させる。以前は「第N営業日に 0」を
   * 入力すると、その場で無視して前の値を残していた。画面には 0 が出たまま
   * 説明とプレビューと保存値だけが古い値のままになり、何が保存されるのか
   * 分からなくなっていた。おかしな値はそのまま持ち、検証で弾いて保存を止める。
   *
   * 打っている途中で作り直さないのも同じ理由。数値を1文字打つたびに
   * 行ごと作り直すと入力欄から焦点が外れ、続きが打てなかった。
   * 欄の顔ぶれが変わるとき（決め方の切り替え・追加・削除）だけ作り直す。
   */
  private buildNotices(): HTMLElement {
    const list = h('div', { class: 'rows' });

    /** 値だけを差し替える。欄の顔ぶれは変えないので作り直さない。 */
    const setTiming = (index: number, timing: NoticeTiming): void => {
      const notice = this.draft.notices[index];
      if (notice === undefined) return;
      this.draft.notices[index] = { ...notice, timing };
      this.rememberTiming(notice.id, timing);
      this.syncNoticeHints();
      this.refresh();
    };

    /** 決め方そのものを差し替える。欄の顔ぶれが変わるので作り直す。 */
    const switchKind = (index: number, kind: NoticeTiming['kind']): void => {
      const notice = this.draft.notices[index];
      if (notice === undefined) return;
      // 前に触っていた値があれば戻す。切り替えて戻すたびに初期値へ落ちると、
      // 見比べるだけのつもりが設定をやり直す羽目になる。
      const timing = this.recallTiming(notice.id, kind, roleOf(notice));
      this.draft.notices[index] = { ...notice, timing };
      render();
      this.refresh();
    };

    const addNotice = (label: string, timing: NoticeTiming, role: 'before' | 'after'): void => {
      // id を先に決める。順番ではなくこれが外部カレンダーの識別子になる。
      this.draft.notices.push(createNotice({ label, timing, role }, this.draft.notices));
      render();
      this.refresh();
    };

    const render = (): void => {
      clear(list);
      this.noticeHints = [];

      this.draft.notices.forEach((notice, index) => {
        const timing = timingOf(notice);
        const ordinal = `${index + 1} 件目`;
        const rows = h('div', { class: 'notice-rows' });

        rows.append(
          h(
            'div',
            { class: 'notice-head' },
            subField(
              '予定名',
              named(
                textInput(notice.label, (value) => {
                  const current = this.draft.notices[index];
                  if (current !== undefined) current.label = value;
                  this.syncNoticeHints();
                  this.refresh();
                }, '例: 振込データ作成'),
                `${ordinal}: 予定名`,
              ),
            ),
            subField(
              '日付の決め方',
              named(
                select(TIMING_KIND_OPTIONS, timing.kind, (value) => switchKind(index, value)),
                `${ordinal}: 日付の決め方`,
              ),
            ),
            button('削除', () => {
              this.draft.notices.splice(index, 1);
              render();
              this.refresh();
            }, 'button button-sm button-quiet notice-remove'),
          ),
        );

        rows.append(
          this.buildTimingRow(
            // 「月末から」を選んだ直後に日数を打つ、のように欄どうしが影響し合う。
            // 作った時点の値を握ったままだと、片方の変更がもう片方に無視される。
            () => timingOf(this.draft.notices[index] ?? notice),
            ordinal,
            (next) => setTiming(index, next),
          ),
        );

        // 何が起きるかを文章でも出す。設定欄だけでは読み取りにくいため。
        const hint = h('p', { class: 'field-hint notice-summary' });
        this.noticeHints.push(hint);
        rows.append(hint);
        list.append(h('div', { class: 'notice-item' }, rows));
      });

      list.append(
        h(
          'div',
          { class: 'row' },
          button('＋ 準備日を追加（前）', () => {
            addNotice('準備', { kind: 'offset', offset: -3, unit: 'business' }, 'before');
          }, 'button button-sm'),
          button('＋ フォローを追加（後）', () => {
            addNotice('フォロー', { kind: 'offset', offset: 3, unit: 'business' }, 'after');
          }, 'button button-sm'),
        ),
      );
      this.syncNoticeHints();
    };
    render();

    return h(
      'section',
      { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, '前後の予定（準備日・フォロー）'),
      h(
        'p',
        { class: 'field-hint' },
        '本体の確定日を起点に、前（準備）と後（フォロー）の予定を出せます。' +
          '本体が営業日補正で動けば、前後の予定も一緒に動きます。' +
          'メールやプッシュ通知は送信しません。',
      ),
      h(
        'p',
        { class: 'field-hint' },
        '日付の決め方は3通り。日数（3営業日前）、週と曜日（翌週水曜）、' +
          '月と第N営業日（翌月第5営業日）。実際の日付は下のプレビューで確かめられます。',
      ),
      list,
    );
  }

  /**
   * 決め方ごとの入力欄。ここで作る欄の顔ぶれは決め方の中では変わらない。
   *
   * 今の値は握らずに `read()` で毎回取り直す。「月末から」を選んでから日数を打つ、
   * のように欄どうしが影響し合うため、作った時点の値を握ったままだと
   * 片方の変更をもう片方が無視して打ち消してしまう。
   */
  private buildTimingRow(
    read: () => NoticeTiming,
    ordinal: string,
    onChange: (next: NoticeTiming) => void,
  ): HTMLElement {
    const timing = read();
    if (timing.kind === 'offset') {
      /** 今の設定。日数側と向き側が互いを打ち消さないよう毎回取り直す。 */
      const current = (): { offset: number; unit: 'business' | 'calendar' } => {
        const now = read();
        return now.kind === 'offset' ? now : timing;
      };
      /**
       * 前か後かは符号ではなくこの旗で覚える。
       *
       * 打ち直そうとして欄を空にすると値は 0 になり、負を保つつもりで -0 を
       * 書き戻すことになる。JavaScript では `-0 < 0` が false なので、
       * 次の1文字で「前」が黙って「後」へ変わってしまう。
       */
      let follow = timing.offset >= 0;
      return h(
        'div',
        { class: 'row notice-row' },
        subField(
          '本体から',
          named(
            // 入力された数をそのまま持つ。0 や空欄は検証で弾く。
            numberInput(Math.abs(timing.offset), (value) => {
              onChange({ kind: 'offset', unit: current().unit, offset: follow ? value : -value });
            }, { min: 1, max: 365 }),
            `${ordinal}: 本体から何日か`,
          ),
        ),
        subField(
          '単位',
          named(
            select(UNIT_OPTIONS, timing.unit, (value) =>
              onChange({ kind: 'offset', offset: current().offset, unit: value }),
            ),
            `${ordinal}: 単位`,
          ),
        ),
        subField(
          '前か後か',
          named(
            select(ROLE_OPTIONS, follow ? 'after' : 'before', (value) => {
              follow = value === 'after';
              const now = current();
              const size = Math.abs(now.offset);
              onChange({ kind: 'offset', unit: now.unit, offset: follow ? size : -size });
            }),
            `${ordinal}: 本体の前か後か`,
          ),
        ),
      );
    }

    if (timing.kind === 'weekday') {
      const current = (): typeof timing => {
        const now = read();
        return now.kind === 'weekday' ? now : timing;
      };
      return h(
        'div',
        { class: 'row notice-row' },
        subField(
          'どの週',
          named(
            select(WEEK_OPTIONS, String(timing.weeks), (value) =>
              onChange({ ...current(), weeks: Number(value) }),
            ),
            `${ordinal}: どの週か`,
          ),
        ),
        subField(
          '曜日',
          named(
            select(
              WEEKDAY_NAMES.map((name, weekday) => ({ value: String(weekday), label: `${name}曜` })),
              String(timing.weekday),
              (value) => onChange({ ...current(), weekday: Number(value) as Weekday }),
            ),
            `${ordinal}: 曜日`,
          ),
        ),
        subField(
          'その日が休業日なら',
          named(
            select(ON_CLOSED_OPTIONS, timing.onClosed, (value) =>
              onChange({ ...current(), onClosed: value }),
            ),
            `${ordinal}: 曜日が休業日のとき`,
          ),
        ),
      );
    }

    // 月末からの指定に負の数を使わせない。繰り返し設定と同じ「月初から／月末から」
    // ＋営業日数の形にする。負数が要ることは読み上げ用のラベルにしか書けておらず、
    // 画面を見ているだけでは気づけなかった。
    const current = (): typeof timing => {
      const now = read();
      return now.kind === 'monthlyBusinessDay' ? now : timing;
    };
    // 月初からか月末からかも符号ではなく旗で覚える。欄を空にすると 0 になり、
    // -0 を書き戻しても `-0 < 0` は false なので数え方が黙って入れ替わる。
    let fromEnd = timing.nth < 0;
    return h(
      'div',
      { class: 'row notice-row' },
      subField(
        'どの月',
        named(
          select(MONTH_OPTIONS, String(timing.months), (value) =>
            onChange({ ...current(), months: Number(value) }),
          ),
          `${ordinal}: どの月か`,
        ),
      ),
      subField(
        '数え方',
        named(
          select(NTH_ORIGIN_OPTIONS, fromEnd ? 'end' : 'start', (value) => {
            fromEnd = value === 'end';
            const size = Math.abs(current().nth);
            onChange({ ...current(), nth: fromEnd ? -size : size });
          }),
          `${ordinal}: 月初から数えるか月末から数えるか`,
        ),
      ),
      subField(
        '営業日',
        h(
          'div',
          { class: 'inline' },
          named(
            // 0 も空欄もそのまま持つ。前の値をこっそり残さない。
            numberInput(Math.abs(timing.nth), (value) => {
              onChange({ ...current(), nth: fromEnd ? -value : value });
            }, { min: 1, max: 25 }),
            `${ordinal}: 営業日数`,
          ),
          h('span', { class: 'unit' }, '営業日目'),
        ),
      ),
    );
  }

  /** 決め方ごとの編集値を覚えておく。切り替えて戻したときに初期値へ落とさないため。 */
  private rememberTiming(noticeId: string | undefined, timing: NoticeTiming): void {
    if (noticeId === undefined) return;
    const kept = this.timingDrafts.get(noticeId) ?? {};
    kept[timing.kind] = timing;
    this.timingDrafts.set(noticeId, kept);
  }

  private recallTiming(
    noticeId: string | undefined,
    kind: NoticeTiming['kind'],
    role: 'before' | 'after',
  ): NoticeTiming {
    const kept = noticeId === undefined ? undefined : this.timingDrafts.get(noticeId)?.[kind];
    return kept ?? defaultTimingFor(kind, role);
  }

  /** 「→ 本体の3営業日前」の行を今の設定に合わせる。作り直さずに文字だけ替える。 */
  private syncNoticeHints(): void {
    this.draft.notices.forEach((notice, index) => {
      const hint = this.noticeHints[index];
      if (hint === undefined) return;
      hint.textContent = `→ 本体の${describeTiming(timingOf(notice))}`;
    });
  }
  private buildPeriod(): HTMLElement {
    return h(
      'section',
      { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, '有効期間'),
      h(
        'div',
        { class: 'row' },
        named(
          dateInput(this.draft.period.start, (value) => {
            this.draft.period.start = value;
            this.refresh();
          }),
          '有効期間の開始日',
        ),
        h('span', { class: 'unit' }, '〜'),
        named(
          dateInput(this.draft.period.end, (value) => {
            this.draft.period.end = value;
            this.refresh();
          }),
          '有効期間の終了日',
        ),
      ),
      h('p', { class: 'field-hint' }, '空欄なら無期限です。'),
    );
  }

  private buildSkipDates(): HTMLElement {
    const list = h('ul', { class: 'chips-list' });
    const picker = named(
      h('input', { type: 'date', class: 'input skip-date-picker' }),
      '除外する日付',
    );

    const render = (): void => {
      clear(list);
      for (const [index, date] of this.draft.skipDates.entries()) {
        list.append(
          h(
            'li',
            { class: 'chip-static' },
            date,
            button('×', () => {
              this.draft.skipDates.splice(index, 1);
              render();
              this.refresh();
            }, 'chip-remove'),
          ),
        );
      }
      if (this.draft.skipDates.length === 0) {
        list.append(h('li', { class: 'field-hint' }, '除外日はありません。'));
      }
    };
    render();

    return h(
      'section',
      { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, '除外日'),
      h(
        'p',
        { class: 'field-hint' },
        '補正前の日付（基準日）を指定します。例: 毎月10日のルールで 2026-08-10 だけ実行しない。',
      ),
      list,
      h(
        'div',
        { class: 'row' },
        picker,
        button('除外に追加', () => {
          const value = picker.value;
          if (value === '' || this.draft.skipDates.includes(value)) return;
          this.draft.skipDates = [...this.draft.skipDates, value].sort();
          picker.value = '';
          render();
          this.refresh();
        }, 'button button-sm'),
      ),
    );
  }

  private buildPreview(): HTMLElement {
    return h(
      'section',
      { class: 'editor-section preview' },
      h('h3', { class: 'editor-heading' }, `次の${PREVIEW_COUNT}回`),
      this.previewBody,
    );
  }

  private buildActions(): HTMLElement {
    const actions = h(
      'div',
      { class: 'editor-actions' },
      h('button', { type: 'submit', class: 'button button-primary' }, '保存'),
      button('キャンセル', () => this.handlers.onCancel(), 'button'),
    );
    if (!this.isNew && this.handlers.onDelete !== undefined) {
      const onDelete = this.handlers.onDelete;
      actions.append(
        button('削除', () => onDelete(this.draft.id), 'button button-danger'),
      );
    }
    return actions;
  }

  // -------------------------------------------------------------------------
  // プレビューと検証
  // -------------------------------------------------------------------------

  /** 入力が変わるたびにプレビューと検証結果を更新する。 */
  private refresh(): void {
    this.summaryBody.textContent = `${describeRule(this.draft)}（${this.calendars.find((calendar) => calendar.id === this.draft.calendarId)?.name ?? 'カレンダー未設定'}）`;
    this.nextDates.textContent = '';
    const issues = validateRule(this.draft);
    clear(this.issuesBody);
    // 検証結果はまとまりとして読み上げさせる。増減が伝わるよう live region にする。
    this.issuesBody.setAttribute('role', 'status');
    this.issuesBody.setAttribute('aria-live', 'polite');
    for (const issue of issues) {
      this.issuesBody.append(
        h('p', { class: `issue issue-${issue.severity}` }, issue.message),
      );
    }

    clear(this.previewBody);
    if (issues.some((issue) => issue.severity === 'error')) {
      this.previewBody.append(
        h('p', { class: 'field-hint' }, '設定を修正するとプレビューを表示します。'),
      );
      return;
    }

    const series = previewSeries(this.draft, this.today, PREVIEW_COUNT, this.ctx);
    const occurrences = series.map((item) => item.main);
    // 直近の1組を、詳細を開かずに見せる。設定項目だけでは結果が想像しにくく、
    // 「次の10回をすべて見る」を開かないと確かめられないのは遠い。
    clear(this.nextDates);
    const dayLabel = (date: string): string =>
      `${date}（${WEEKDAY_NAMES[weekdayOf(date)] ?? ''}）`;

    const first = series[0];
    if (first !== undefined) {
      // 曜日まで出す。「翌週水曜」のように曜日で決めた設定は、日付だけでは
      // 合っているか確かめられない。
      const chain: string[] = [];
      for (const item of first.related) {
        if (item.date < first.main.date) chain.push(`${dayLabel(item.date)} ${item.noticeLabel ?? '準備'}`);
      }
      chain.push(
        `${dayLabel(first.main.date)} ${this.draft.title === '' ? '（この予定）' : this.draft.title}`,
      );
      for (const item of first.related) {
        if (item.date >= first.main.date) chain.push(`${dayLabel(item.date)} ${item.noticeLabel ?? 'フォロー'}`);
      }
      this.nextDates.append(
        h('span', { class: 'next-dates-label' }, '直近:'),
        h('span', { class: 'next-dates-chain' }, chain.join(' → ')),
      );
      // なぜその日になったのか。記号だけだと設定と結果が結び付かない。
      if (first.main.shifted) {
        this.nextDates.append(
          h(
            'span',
            { class: 'next-dates-note' },
            `${dayLabel(first.main.rawDate)}が休業日のため${
              first.main.shiftDirection === 'prev' ? '前営業日へ' : '翌営業日へ'
            }`,
          ),
        );
      }
    }
    if (occurrences.length === 0) {
      this.previewBody.append(
        h('p', { class: 'issue issue-warning' }, 'この設定では発生する日がありません。'),
      );
      return;
    }

    // 日付を決められなかった前後予定は、保存する前に理由ごと見せる。
    // プレビューから黙って消えるだけだと「設定したのに出ない」に気づけない。
    const unresolved = new Map<string, string>();
    const crossed = new Map<string, string>();
    for (const item of series) {
      for (const { notice, reason } of item.unresolved) {
        unresolved.set(`${notice.id ?? notice.label}-${reason}`, `「${notice.label}」は ${reason}`);
      }
      for (const warning of item.warnings) crossed.set(warning.message, warning.message);
    }
    for (const message of unresolved.values()) {
      this.previewBody.append(h('p', { class: 'issue issue-warning' }, `日付を決められません: ${message}`));
    }
    for (const message of crossed.values()) {
      this.previewBody.append(h('p', { class: 'issue issue-warning' }, message));
    }

    const list = h('ol', { class: 'preview-list' });
    for (const { main, related, unresolved: missing } of series) {
      const item = h(
        'li',
        { class: main.shifted ? 'is-shifted' : '' },
        h('span', { class: 'preview-date' }, main.date),
        h('span', { class: 'preview-weekday' }, `(${WEEKDAY_NAMES[weekdayOf(main.date)]})`),
        // カレンダー上の ← → と同じ向き記号を使い、読み替えの手間をなくす。
        // 「なぜ動いたか」を言葉で添える。記号だけだと設定と結果が結び付かない。
        main.shifted
          ? h(
              'span',
              { class: `preview-note is-${main.shiftDirection ?? 'prev'}` },
              `${main.shiftDirection === 'prev' ? '←' : '→'} ${dayLabel(main.rawDate)}が休業日のため${
                main.shiftDirection === 'prev' ? '前営業日へ' : '翌営業日へ'
              }`,
            )
          : null,
      );

      // 前後の予定も実際の日付で並べる。本体の日付しか出していなかったため、
      // 「3営業日前」と「3営業日後」を取り違えていても画面で気づけなかった。
      if (related.length > 0 || missing.length > 0) {
        const chain = h('ul', { class: 'preview-related' });
        for (const item2 of related) {
          chain.append(
            h(
              'li',
              { class: `preview-related-item is-${item2.kind}` },
              h('span', { class: 'preview-related-mark' }, item2.kind === 'follow' ? '↓後' : '↑前'),
              h('span', { class: 'preview-date' }, dayLabel(item2.date)),
              h('span', { class: 'preview-related-label' }, item2.noticeLabel ?? ''),
            ),
          );
        }
        // 消さずに、その回ごとに「計算できません」と理由を残す。
        for (const { notice, reason } of missing) {
          chain.append(
            h(
              'li',
              { class: 'preview-related-item is-unresolved' },
              h('span', { class: 'preview-related-mark' }, '—'),
              h('span', { class: 'preview-date' }, '計算できません'),
              h('span', { class: 'preview-related-label' }, `${notice.label}: ${reason}`),
            ),
          );
        }
        item.append(chain);
      }
      list.append(item);
    }
    this.previewBody.append(list);
  }

  private save(): void {
    const issues = validateRule(this.draft);
    if (issues.some((issue) => issue.severity === 'error')) {
      this.refresh();
      // 何を直せばよいか分かるよう、最初の不正項目へ移動する。
      const target = this.element.querySelector<HTMLElement>('input, select, textarea');
      target?.focus();
      return;
    }
    this.handlers.onSave({ ...structuredClone(this.draft), updatedAt: new Date().toISOString() });
  }
}
