/**
 * ルール編集フォーム（docs/SPEC.md §8.4）。
 *
 * 中心は「次回以降の発生日プレビュー」。反復条件と営業日補正の組み合わせは
 * 頭の中で追いにくいため、入力するそばから実際の日付を見せることで誤設定を防ぐ。
 */

import { describeNotice } from '../core/describe';
import { todayInTokyo, weekdayOf } from '../core/dateUtil';
import { previewOccurrences } from '../core/schedule';
import type { ScheduleContext } from '../core/schedule';
import { validateRule } from '../core/validate';
import type {
  BusinessCalendar,
  ColorToken,
  DateStr,
  Month,
  Notice,
  NthWeekday,
  Recurrence,
  Rule,
  Weekday,
} from '../types';
import {
  button,
  checkbox,
  dateInput,
  field,
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
];

/** 種類を切り替えても入力を失わないよう、種類ごとの下書きを持つ。 */
function defaultDrafts(current: Recurrence): Record<RecurrenceKind, Recurrence> {
  const drafts: Record<RecurrenceKind, Recurrence> = {
    weekly: { type: 'weekly', interval: 1, weekdays: [1] },
    monthlyByDay: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
    monthlyByWeekday: { type: 'monthlyByWeekday', interval: 1, nth: [1], weekday: 2 },
    monthlyByBusinessDay: { type: 'monthlyByBusinessDay', interval: 1, nth: [5] },
  };
  drafts[current.type] = current;
  return drafts;
}

export type RuleEditorHandlers = {
  onSave: (rule: Rule) => void;
  onCancel: () => void;
  onDelete?: (ruleId: string) => void;
};

export class RuleEditor {
  readonly element: HTMLFormElement;

  private draft: Rule;
  private readonly drafts: Record<RecurrenceKind, Recurrence>;
  private readonly recurrenceBody = h('div', { class: 'recurrence-body' });
  private readonly previewBody = h('div', { class: 'preview-body' });
  private readonly issuesBody = h('div', { class: 'issues' });
  private readonly today: DateStr;

  constructor(
    initial: Rule,
    private readonly calendars: readonly BusinessCalendar[],
    private readonly ctx: ScheduleContext,
    private readonly handlers: RuleEditorHandlers,
    private readonly isNew: boolean,
    today: DateStr = todayInTokyo(),
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
      this.buildBasics(),
      this.buildRecurrence(),
      this.buildAdjust(),
      this.buildNotices(),
      this.buildPeriod(),
      this.buildSkipDates(),
      this.buildPreview(),
      this.issuesBody,
      this.buildActions(),
    );

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.save();
    });
    return form;
  }

  private buildBasics(): HTMLElement {
    const title = textInput(this.draft.title, (value) => {
      this.draft.title = value;
      this.refresh();
    }, '例: 給与振込');

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
      field('タイトル', title),
      field('色', colorRow),
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
        'メモ',
        textInput(this.draft.note ?? '', (value) => {
          this.draft.note = value;
        }, '任意'),
      ),
      checkbox('このルールを有効にする', this.draft.enabled, (value) => {
        this.draft.enabled = value;
      }),
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
        this.refresh();
      });
      tabs.append(tab);
    }

    return h(
      'section',
      { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, '繰り返し'),
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
    }
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
          select(
            [
              { value: 'start', label: '月初から' },
              { value: 'end', label: '月末から' },
            ],
            fromEnd ? 'end' : 'start',
            (value) => {
              const magnitude = Math.abs(recurrence.nth[index] ?? 1);
              recurrence.nth[index] = value === 'end' ? -magnitude : magnitude;
              this.refresh();
            },
          ),
          numberInput(Math.abs(nth), (value) => {
            const magnitude = Math.max(1, Math.floor(value));
            recurrence.nth[index] = fromEnd ? -magnitude : magnitude;
            this.refresh();
          }, { min: 1, max: 31 }),
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

    return field('対象月', container, '何も選ばなければ毎月。1つだけ選ぶと年次になります。');
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

    const section = h(
      'section',
      { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, '休業日にあたったとき'),
      field(
        '補正',
        modeSelect,
        '「前後の営業日の両方へ」は、取引先ごとに前倒し・後ろ倒しが分かれるときに使います。1つの基準日から前後2件が表示されます。',
      ),
      keepInMonth,
    );

    // 第N営業日は定義上すでに営業日なので、補正の設定自体を隠す。
    if (this.draft.recurrence.type === 'monthlyByBusinessDay') {
      section.append(
        h('p', { class: 'field-hint' }, '「第N営業日」は常に営業日のため、補正は行われません。'),
      );
    }
    return section;
  }

  private buildNotices(): HTMLElement {
    const list = h('div', { class: 'rows' });

    const render = (): void => {
      clear(list);
      this.draft.notices.forEach((notice, index) => {
        list.append(
          h(
            'div',
            { class: 'row' },
            numberInput(Math.abs(notice.offset), (value) => {
              notice.offset = -Math.max(1, Math.floor(value));
              this.refresh();
            }, { min: 1, max: 60 }),
            select(
              [
                { value: 'business', label: '営業日前' },
                { value: 'calendar', label: '日前' },
              ],
              notice.unit,
              (value) => {
                notice.unit = value;
                this.refresh();
              },
            ),
            textInput(notice.label, (value) => {
              notice.label = value;
            }, '例: 振込データ作成'),
            button('削除', () => {
              this.draft.notices.splice(index, 1);
              render();
              this.refresh();
            }, 'button button-sm button-quiet'),
          ),
        );
      });
      list.append(
        button('＋ 事前通知を追加', () => {
          const notice: Notice = { offset: -3, unit: 'business', label: '準備' };
          this.draft.notices.push(notice);
          render();
          this.refresh();
        }, 'button button-sm'),
      );
    };
    render();

    return h(
      'section',
      { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, '事前通知'),
      h('p', { class: 'field-hint' }, '確定日から遡って、準備日をカレンダーに表示します。'),
      list,
    );
  }

  private buildPeriod(): HTMLElement {
    return h(
      'section',
      { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, '有効期間'),
      h(
        'div',
        { class: 'row' },
        dateInput(this.draft.period.start, (value) => {
          this.draft.period.start = value;
          this.refresh();
        }),
        h('span', { class: 'unit' }, '〜'),
        dateInput(this.draft.period.end, (value) => {
          this.draft.period.end = value;
          this.refresh();
        }),
      ),
      h('p', { class: 'field-hint' }, '空欄なら無期限です。'),
    );
  }

  private buildSkipDates(): HTMLElement {
    const list = h('ul', { class: 'chips-list' });
    const picker = h('input', { type: 'date', class: 'input skip-date-picker' });

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
    const issues = validateRule(this.draft);
    clear(this.issuesBody);
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

    const occurrences = previewOccurrences(this.draft, this.today, PREVIEW_COUNT, this.ctx);
    if (occurrences.length === 0) {
      this.previewBody.append(
        h('p', { class: 'issue issue-warning' }, 'この設定では発生する日がありません。'),
      );
      return;
    }

    const list = h('ol', { class: 'preview-list' });
    for (const occurrence of occurrences) {
      list.append(
        h(
          'li',
          { class: occurrence.shifted ? 'is-shifted' : '' },
          h('span', { class: 'preview-date' }, occurrence.date),
          h('span', { class: 'preview-weekday' }, `(${WEEKDAY_NAMES[weekdayOf(occurrence.date)]})`),
          // カレンダー上の ← → と同じ向き記号を使い、読み替えの手間をなくす。
          occurrence.shifted
            ? h(
                'span',
                { class: `preview-note is-${occurrence.shiftDirection ?? 'prev'}` },
                `${occurrence.shiftDirection === 'prev' ? '←' : '→'} ${occurrence.rawDate} から${
                  occurrence.shiftDirection === 'prev' ? '前倒し' : '後ろ倒し'
                }`,
              )
            : null,
        ),
      );
    }
    this.previewBody.append(list);

    for (const notice of this.draft.notices) {
      const first = occurrences[0];
      if (first === undefined) break;
      this.previewBody.append(
        h(
          'p',
          { class: 'field-hint' },
          `事前通知「${notice.label}」は各回の${describeNotice(notice.offset, notice.unit)}に表示されます。`,
        ),
      );
    }
  }

  private save(): void {
    const issues = validateRule(this.draft);
    if (issues.some((issue) => issue.severity === 'error')) {
      this.refresh();
      return;
    }
    this.handlers.onSave({ ...structuredClone(this.draft), updatedAt: new Date().toISOString() });
  }
}
