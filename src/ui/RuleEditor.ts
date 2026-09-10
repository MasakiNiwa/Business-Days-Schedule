/**
 * ルール編集フォーム（docs/SPEC.md §8.4）。
 *
 * 中心は「次回以降の発生日プレビュー」。反復条件と営業日補正の組み合わせは
 * 頭の中で追いにくいため、入力するそばから実際の日付を見せることで誤設定を防ぐ。
 */

import { describeRule, describeTiming } from '../core/describe';
import { createNotice, legacyNoticeId, roleOf, timingOf } from '../core/notice';
import { createRule } from '../core/storage';
import { todayInTokyo, weekdayOf } from '../core/dateUtil';
import { previewSeries } from '../core/schedule';
import type { ScheduleContext } from '../core/schedule';
import { LIMITS, validateRule } from '../core/validate';
import type {
  BusinessCalendar,
  ColorToken,
  DateStr,
  Month,
  Notice,
  NoticeRole,
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
import { clear, h, scrollIntoView } from './dom';

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

/**
 * 前後予定の編集中の状態。
 *
 * モデル（NoticeTiming）は向きを符号で表すが、画面は「大きさ」と「向き」を
 * 別々の欄に分けている。畳んで持つと情報が落ちる（`-0 < 0` は false、
 * `-(-3)` は 3）ので、編集中は分けたまま持つ。
 *
 * 決め方ごとの値を3つとも持っておくのは、切り替えて戻したときに元の値へ
 * 戻すため。片方しか持たないと、見比べただけで設定が変わってしまう。
 */
type TimingState = {
  kind: NoticeTiming['kind'];
  /**
   * 設定が向きを言わないとき（同じ週・同じ月）に使う、持ち主の意図。
   *
   * ここを毎回「後」で塗り替えていたため、同じ週の準備予定を開いて保存する
   * だけで役割が変わり、外部カレンダーの識別子まで変わっていた。
   * 日付の設定を触っていないのに別の予定として扱われる。
   */
  role: NoticeRole;
  offset: { size: number; unit: 'business' | 'calendar'; role: NoticeRole };
  weekday: { weeks: number; weekday: Weekday; onClosed: 'next' | 'prev' | 'none' };
  monthlyBusinessDay: { months: number; size: number; fromEnd: boolean };
};

/** 決め方ごとの初期値。役割（前・後）に近い形から始める。 */
function defaultTimingState(role: NoticeRole): TimingState {
  return {
    kind: 'offset',
    role,
    offset: { size: 3, unit: 'business', role },
    weekday: { weeks: role === 'before' ? -1 : 1, weekday: 3, onClosed: 'next' },
    monthlyBusinessDay: { months: role === 'before' ? 0 : 1, size: 5, fromEnd: false },
  };
}

/** 今の設定から編集状態を作る。触っていない決め方は既定値で埋める。 */
function timingStateOf(timing: NoticeTiming, role: NoticeRole): TimingState {
  const state = defaultTimingState(role);
  state.kind = timing.kind;
  switch (timing.kind) {
    case 'offset':
      state.offset = {
        size: Math.abs(timing.offset),
        unit: timing.unit,
        role: timing.offset < 0 ? 'before' : 'after',
      };
      break;
    case 'weekday':
      state.weekday = { weeks: timing.weeks, weekday: timing.weekday, onClosed: timing.onClosed };
      break;
    case 'monthlyBusinessDay':
      state.monthlyBusinessDay = {
        months: timing.months,
        size: Math.abs(timing.nth),
        fromEnd: timing.nth < 0,
      };
      break;
  }
  return state;
}

/** 編集状態を保存する形へ畳む。符号を付けるのはここだけ。 */
function timingOfState(state: TimingState): NoticeTiming {
  switch (state.kind) {
    case 'offset': {
      const { size, unit, role } = state.offset;
      return { kind: 'offset', offset: role === 'before' ? -size : size, unit };
    }
    case 'weekday':
      return { kind: 'weekday', ...state.weekday };
    case 'monthlyBusinessDay': {
      const { months, size, fromEnd } = state.monthlyBusinessDay;
      return { kind: 'monthlyBusinessDay', months, nth: fromEnd ? -size : size };
    }
  }
}

/**
 * 設定上の向き。畳む前の状態から決まる。
 *
 * ずらす数が 0 のとき（同じ週・同じ月）は設定からは決まらないので、
 * 持ち主の意図をそのまま残す。ここで「後」に寄せると、既存の準備予定が
 * 開いて保存するだけでフォローに変わってしまう。
 */
function roleOfState(state: TimingState): NoticeRole {
  switch (state.kind) {
    case 'offset':
      return state.offset.role;
    case 'weekday':
      return state.weekday.weeks === 0 ? state.role : state.weekday.weeks < 0 ? 'before' : 'after';
    case 'monthlyBusinessDay': {
      const months = state.monthlyBusinessDay.months;
      return months === 0 ? state.role : months < 0 ? 'before' : 'after';
    }
  }
}

/**
 * 畳めない値かどうか。畳めないものは無理に保存する形へ直さない。
 *
 * 「前」を選んだまま -3 を入れると、符号を付けた結果が +3 になり、
 * 画面は「前」なのに保存されるのは「3営業日後」になっていた。
 * 大きさは常に正の整数として扱い、向きは選択欄だけが決める。
 */
function timingStateIssue(state: TimingState): TimingStateIssue | null {
  const positive = (size: number, name: string, max: number): string | null => {
    if (!Number.isInteger(size) || size < 1) return `${name}は 1 以上の整数で入力してください`;
    if (size > max) return `${name}は ${max} 以下で入力してください`;
    return null;
  };
  // いまのところ問題が起きるのは大きさの欄だけ。直す場所へ運べるよう、
  // 文言だけでなく「どの欄か」も返す（行の先頭の欄へ運んでも直せない）。
  const message =
    state.kind === 'offset'
      ? positive(state.offset.size, '本体からの日数', LIMITS.noticeOffset)
      : state.kind === 'monthlyBusinessDay'
        ? positive(state.monthlyBusinessDay.size, '営業日数', LIMITS.noticeNth)
        : null;
  return message === null ? null : { field: 'size', message };
}

/** 画面の状態そのものの問題。`field` は直すべき欄。 */
type TimingStateIssue = { field: 'size'; message: string };

export class RuleEditor {
  readonly element: HTMLFormElement;

  private draft: Rule;
  private readonly drafts: Record<RecurrenceKind, Recurrence>;
  private readonly recurrenceBody = h('div', { class: 'recurrence-body' });
  /** 「→ 本体の3営業日前」の行。作り直さずに文字だけ替えるため持っておく。 */
  private noticeHints: HTMLElement[] = [];
  /** 前後予定ごとのエラー表示欄。直す場所が分かるよう、その欄の直下に出す。 */
  private noticeIssueSlots: HTMLElement[] = [];
  /**
   * 前後予定ごとの編集状態。行を作り直しても消えないよう id で覚える。
   * 編集を始めた時点の値もここに登録する（登録しないと切り替えで既定値へ落ちる）。
   */
  private readonly timingStates = new Map<string, TimingState>();
  /** 開いた直後の姿。変更があるかの判定に使う。 */
  private baseline = '';
  private readonly previewBody = h('div', { class: 'preview-body' });
  private readonly issuesBody = h('div', { class: 'issues' });
  /**
   * 保存ボタンのそばに常に出す注意書き。
   *
   * 折りたたみの中にしか出していなかったため、閉じたままだと直近プレビューから
   * 関連予定が消えるだけで、日付を決められない予定があることに気づかず
   * 保存できてしまっていた。
   */
  private readonly alertsBody = h('div', { class: 'editor-alerts issues' });
  /** 「次の10回をすべて見る」。注意書きから内訳へ運ぶために持っておく。 */
  private readonly previewDetails = h('details', { class: 'advanced-options' });
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
    // 読み込みの整え（前後予定の id 付けなど）が済んだあとを「触っていない状態」
    // とする。ここより前に取ると、開いただけで変更ありと見なしてしまう。
    this.baseline = this.snapshot();
  }

  /**
   * 開いたときから何か変わっているか。閉じる前の確認に使う。
   *
   * 入力途中で Esc を押す・背景を触るのは起こりやすく、確認なしに閉じると
   * 前後の予定まで組んだ内容が消える。
   */
  isDirty(): boolean {
    return this.snapshot() !== this.baseline;
  }

  /**
   * 比べるための姿。updatedAt は保存時に付け替わるので外す。
   *
   * 編集中の状態も混ぜる。日数を消して空欄にした状態は、畳めないので
   * 保存する形へは書き戻していない。保存用データだけを比べると、
   * 打ち直している最中は「触っていない」ことになり、閉じる確認をすり抜ける。
   */
  private snapshot(): string {
    const { updatedAt: _updatedAt, ...rest } = this.draft;
    const editing = this.draft.notices.map((notice) => [
      notice.id,
      this.timingStates.get(notice.id ?? ''),
    ]);
    return JSON.stringify({ rest, editing });
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
      this.buildPreviewDetails(),
      h(
        'div',
        { class: 'editor-review' },
        this.summaryBody,
        this.nextDates,
        this.alertsBody,
        this.issuesBody,
        this.buildActions(),
      ),
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
   * 画面の状態はモデル（NoticeTiming）と同じ形では持たない。モデルは向きを
   * 符号で表すが、画面は「大きさ」と「向き」を別々の欄に分けている。
   * これを符号ひとつに畳んで持つと、次の3つが起きた。
   *
   *   - 決め方を切り替えて戻すと、元の値ではなく既定値に戻る
   *   - 日数に負の数を入れると、「前」を選んだまま後ろの日付になる
   *   - 欄を空にしたまま別の予定を追加すると、向きが入れ替わる
   *
   * いずれも、符号ひとつに畳むときに情報が落ちることが原因だった
   * （`-0 < 0` は false、`-(-3)` は 3）。編集中は分けたまま持ち、
   * 保存する形へ畳むのは書き出すときだけにする。
   *
   * 状態は予定の id で覚える。行を作り直しても消えないようにするため。
   */
  private buildNotices(): HTMLElement {
    const list = h('div', { class: 'rows' });

    /** 欄の顔ぶれが変わらない変更。作り直さないので入力中の焦点も残る。 */
    const touch = (): void => {
      this.syncNotices();
      this.refresh();
    };

    /** 欄の顔ぶれが変わる変更（決め方の切り替え・追加・削除）。 */
    const rebuild = (): void => {
      render();
      this.refresh();
    };

    const render = (): void => {
      clear(list);
      this.noticeHints = [];
      this.noticeIssueSlots = [];

      this.draft.notices.forEach((notice, index) => {
        const state = this.timingStateFor(notice);
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
                  touch();
                }, '例: 振込データ作成'),
                `${ordinal}: 予定名`,
              ),
            ),
            subField(
              '日付の決め方',
              named(
                select(TIMING_KIND_OPTIONS, state.kind, (value) => {
                  // 決め方ごとの値はそれぞれ持っているので、切り替えても
                  // 元の値は消えない。比べるために往復しただけで設定が
                  // 変わってしまうのを防ぐ。
                  state.kind = value;
                  rebuild();
                }),
                `${ordinal}: 日付の決め方`,
              ),
            ),
            button('削除', () => {
              this.draft.notices.splice(index, 1);
              rebuild();
            }, 'button button-sm button-quiet notice-remove'),
          ),
        );

        rows.append(this.buildTimingRow(state, ordinal, touch));

        // 直す場所が分かるよう、エラーはその予定の欄の直下に出す。
        const slot = h('div', { class: 'notice-issues' });
        this.noticeIssueSlots.push(slot);
        rows.append(slot);

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
            this.addNotice('準備', { kind: 'offset', offset: -3, unit: 'business' }, 'before');
            rebuild();
          }, 'button button-sm'),
          button('＋ フォローを追加（後）', () => {
            this.addNotice('フォロー', { kind: 'offset', offset: 3, unit: 'business' }, 'after');
            rebuild();
          }, 'button button-sm'),
        ),
      );
      this.syncNotices();
    };
    render();

    return h(
      'section',
      { class: 'editor-section' },
      // 見出しは折りたたみの summary（3. 準備や確認の予定を付ける）が担う。
      // ここにもう1つ置くと、同じことを二度言うことになる。
      h(
        'p',
        { class: 'field-hint' },
        'この予定の確定日を起点に、前（準備）と後（フォロー）を出せます。本体が動けば一緒に動きます。',
      ),
      h(
        'details',
        { class: 'advanced-options' },
        h('summary', {}, '設定例を見る'),
        h(
          'ul',
          { class: 'help-examples' },
          h('li', {}, '給与振込の3営業日前に「振込データ作成」（日数で指定）'),
          h('li', {}, '月次締めの翌週水曜に「報告会」（週と曜日で指定）'),
          h('li', {}, '締めのあと翌月の第5営業日に「請求書発行」（月と第N営業日で指定）'),
          h('li', {}, 'メールやプッシュ通知は送りません。カレンダーに予定として出るだけです。'),
        ),
      ),
      list,
    );
  }

  private buildPreviewDetails(): HTMLElement {
    // 使い回している要素なので、足す前に中身を空にする。
    // ひな型を選ぶと build() がもう一度走り、見出しとプレビューが二重に並んでいた。
    clear(this.previewDetails);
    this.previewDetails.append(h('summary', {}, '次の10回をすべて見る'), this.buildPreview());
    return this.previewDetails;
  }

  /** 1件追加する。id を先に決める（順番ではなくこれが外部カレンダーの識別子になる）。 */
  private addNotice(label: string, timing: NoticeTiming, role: NoticeRole): void {
    const notice = createNotice({ label, timing, role }, this.draft.notices);
    this.draft.notices.push(notice);
    this.timingStateFor(notice);
  }

  /**
   * その予定の編集状態。無ければ今の設定から作る。
   *
   * 編集を始めた時点の値をここで登録しておくのが要点。登録していないと、
   * 決め方を切り替えて戻したときに「覚えていない」ことになり、既定値へ落ちる。
   */
  private timingStateFor(notice: Notice): TimingState {
    const key = notice.id ?? legacyNoticeId(this.draft.notices.indexOf(notice));
    const existing = this.timingStates.get(key);
    if (existing !== undefined) return existing;
    const created = timingStateOf(timingOf(notice), roleOf(notice));
    this.timingStates.set(key, created);
    return created;
  }

  /** 決め方ごとの入力欄。ここで作る欄の顔ぶれは決め方の中では変わらない。 */
  private buildTimingRow(
    state: TimingState,
    ordinal: string,
    onChange: () => void,
  ): HTMLElement {
    if (state.kind === 'offset') {
      const offset = state.offset;
      return h(
        'div',
        { class: 'row notice-row' },
        subField(
          '本体から',
          named(
            // 入力された数をそのまま持つ。向きは別の欄が決めるので、
            // ここに負の数が入っても向きは動かない（検証で弾く）。
            numberInput(offset.size, (value) => {
              offset.size = value;
              onChange();
            }, { min: 1, max: 365, field: 'size' }),
            `${ordinal}: 本体から何日か`,
          ),
        ),
        subField(
          '単位',
          named(
            select(UNIT_OPTIONS, offset.unit, (value) => {
              offset.unit = value;
              onChange();
            }),
            `${ordinal}: 単位`,
          ),
        ),
        subField(
          '前か後か',
          named(
            select(ROLE_OPTIONS, offset.role, (value) => {
              offset.role = value;
              onChange();
            }),
            `${ordinal}: 本体の前か後か`,
          ),
        ),
      );
    }

    if (state.kind === 'weekday') {
      const weekday = state.weekday;
      return h(
        'div',
        { class: 'row notice-row' },
        subField(
          'どの週',
          named(
            select(WEEK_OPTIONS, String(weekday.weeks), (value) => {
              weekday.weeks = Number(value);
              onChange();
            }),
            `${ordinal}: どの週か`,
          ),
        ),
        subField(
          '曜日',
          named(
            select(
              WEEKDAY_NAMES.map((name, day) => ({ value: String(day), label: `${name}曜` })),
              String(weekday.weekday),
              (value) => {
                weekday.weekday = Number(value) as Weekday;
                onChange();
              },
            ),
            `${ordinal}: 曜日`,
          ),
        ),
        subField(
          'その日が休業日なら',
          named(
            select(ON_CLOSED_OPTIONS, weekday.onClosed, (value) => {
              weekday.onClosed = value;
              onChange();
            }),
            `${ordinal}: 曜日が休業日のとき`,
          ),
        ),
      );
    }

    // 月末からの指定に負の数を使わせない。繰り返し設定と同じ「月初から／月末から」
    // ＋営業日数の形にする。符号は保存するときに付けるので、画面は常に正の数。
    const monthly = state.monthlyBusinessDay;
    return h(
      'div',
      { class: 'row notice-row' },
      subField(
        'どの月',
        named(
          select(MONTH_OPTIONS, String(monthly.months), (value) => {
            monthly.months = Number(value);
            onChange();
          }),
          `${ordinal}: どの月か`,
        ),
      ),
      subField(
        '数え方',
        named(
          select(NTH_ORIGIN_OPTIONS, monthly.fromEnd ? 'end' : 'start', (value) => {
            monthly.fromEnd = value === 'end';
            onChange();
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
            numberInput(monthly.size, (value) => {
              monthly.size = value;
              onChange();
            }, { min: 1, max: 25, field: 'size' }),
            `${ordinal}: 営業日数`,
          ),
          h('span', { class: 'unit' }, '営業日目'),
        ),
      ),
    );
  }

  /**
   * 画面の状態を保存する形へ畳み、説明とエラーを今の値に合わせる。
   *
   * 畳めない値（0 や負の日数）のときは、モデルへ書かずに欄の直下へエラーを出す。
   * 無理に畳むと符号が反転し、画面と保存値が食い違う。
   */
  private syncNotices(): void {
    this.draft.notices.forEach((notice, index) => {
      const state = this.timingStateFor(notice);
      const hint = this.noticeHints[index];
      const slot = this.noticeIssueSlots[index];
      const problem = timingStateIssue(state);

      if (slot !== undefined) {
        clear(slot);
        if (problem !== null) slot.append(h('p', { class: 'issue issue-error' }, problem.message));
      }

      if (problem !== null) {
        if (hint !== undefined) hint.textContent = '';
        return;
      }
      const timing = timingOfState(state);
      this.draft.notices[index] = { ...notice, timing, role: roleOfState(state) };
      if (hint !== undefined) hint.textContent = `→ 本体の${describeTiming(timing)}`;
    });
  }

  /** 画面の状態そのものの問題。モデルにできない形なので validateRule では拾えない。 */
  private noticeStateIssues(): { index: number; field: 'size'; message: string }[] {
    const issues: { index: number; field: 'size'; message: string }[] = [];
    this.draft.notices.forEach((notice, index) => {
      const problem = timingStateIssue(this.timingStateFor(notice));
      if (problem !== null) issues.push({ index, ...problem });
    });
    return issues;
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
    // 画面の状態そのものの問題（負の日数など）は、モデルにできない形なので
    // validateRule では拾えない。詳しい文言は各予定の欄の直下に出してあるので、
    // ここでは「どの予定か」だけを示して、直す場所へ導く。
    const stateIssues = this.noticeStateIssues();
    clear(this.issuesBody);
    // 検証結果はまとまりとして読み上げさせる。増減が伝わるよう live region にする。
    this.issuesBody.setAttribute('role', 'status');
    this.issuesBody.setAttribute('aria-live', 'polite');
    // 詳しい文言は各欄の直下に出してある。ここで同じ文を繰り返すと、
    // 保存欄が長くなるだけで直す場所は分からない。件数と場所だけを示す。
    const errorCount =
      stateIssues.length + issues.filter((issue) => issue.severity === 'error').length;
    if (errorCount > 0) {
      const where = stateIssues.map(({ index }) => `前後の予定 ${index + 1} 件目`);
      this.issuesBody.append(
        h(
          'p',
          { class: 'issue issue-error' },
          `修正が必要な項目が ${errorCount} 件あります${where.length === 0 ? '' : `（${where.join('、')}）`}。`,
        ),
      );
    }
    // 画面の他の場所に出していないものは、そのまま読ませる。
    for (const issue of issues) {
      this.issuesBody.append(
        h('p', { class: `issue issue-${issue.severity}` }, issue.message),
      );
    }

    clear(this.previewBody);
    clear(this.alertsBody);
    if (stateIssues.length > 0 || issues.some((issue) => issue.severity === 'error')) {
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

    /**
     * 直近の1組で使う短い書き方。「2026-09-25（金）」を4回並べると、
     * 年が繰り返されるだけで肝心の日が読み取りにくい。年は先に1度だけ出す。
     *
     * ただし本体と違う年のものには年を付ける。年末年始の準備・フォローは
     * 年をまたぐので、「12/31 → 1/8」だと翌年の1月8日が同じ年に見えてしまう。
     */
    const baseYear = first?.main.date.slice(0, 4);
    const shortDay = (date: string): string => {
      const weekday = WEEKDAY_NAMES[weekdayOf(date)] ?? '';
      const md = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
      const year = date.slice(0, 4);
      return `${year === baseYear ? md : `${year}/${md}`}（${weekday}）`;
    };

    if (first !== undefined) {
      // 曜日まで出す。「翌週水曜」のように曜日で決めた設定は、日付だけでは
      // 合っているか確かめられない。
      const chain: string[] = [];
      for (const item of first.related) {
        if (item.date < first.main.date) chain.push(`${shortDay(item.date)} ${item.noticeLabel ?? '準備'}`);
      }
      chain.push(
        `${shortDay(first.main.date)} ${this.draft.title === '' ? '（この予定）' : this.draft.title}`,
      );
      for (const item of first.related) {
        if (item.date >= first.main.date) chain.push(`${shortDay(item.date)} ${item.noticeLabel ?? 'フォロー'}`);
      }
      this.nextDates.append(
        // 年は先に1度だけ。日付を4つ並べると、年が繰り返されるだけで読みにくい。
        h('span', { class: 'next-dates-label' }, `直近（${first.main.date.slice(0, 4)}年）:`),
        h('span', { class: 'next-dates-chain' }, chain.join(' → ')),
      );
      // なぜその日になったのか。記号だけだと設定と結果が結び付かない。
      if (first.main.shifted) {
        this.nextDates.append(
          h(
            'span',
            { class: 'next-dates-note' },
            `${shortDay(first.main.rawDate)}が休業日のため${
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
    //
    // 置き場所は折りたたみの中ではなく、保存ボタンのそば。畳んだままだと
    // 直近プレビューから関連予定が消えるだけで、気づかずに保存できてしまう。
    // 同じ理由が何か月ぶんも続くので、件数にまとめる。
    const unresolved = new Map<string, { label: string; reason: string; count: number }>();
    const crossed = new Map<string, string>();
    for (const item of series) {
      for (const { notice, reason } of item.unresolved) {
        const key = `${notice.id ?? notice.label}-${reason}`;
        const entry = unresolved.get(key) ?? { label: notice.label, reason, count: 0 };
        entry.count += 1;
        unresolved.set(key, entry);
      }
      for (const warning of item.warnings) crossed.set(warning.message, warning.message);
    }
    for (const { label, reason, count } of unresolved.values()) {
      this.alertsBody.append(
        h(
          'p',
          { class: 'issue issue-warning' },
          `「${label}」は ${count} 件の回で日付を決められません（${reason}）`,
        ),
      );
    }
    for (const message of crossed.values()) {
      this.alertsBody.append(h('p', { class: 'issue issue-warning' }, message));
    }
    if (this.alertsBody.childElementCount > 0) {
      this.alertsBody.append(
        button('内訳を見る', () => {
          // その回ごとの説明は下の一覧にある。開いてそこまで運ぶ。
          this.previewDetails.open = true;
          scrollIntoView(this.previewDetails);
        }, 'button button-sm button-quiet'),
      );
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
          const row = h(
            'li',
            { class: `preview-related-item is-${item2.kind}` },
            h('span', { class: 'preview-related-mark' }, item2.kind === 'follow' ? '↓後' : '↑前'),
            h('span', { class: 'preview-date' }, dayLabel(item2.date)),
            h('span', { class: 'preview-related-label' }, item2.noticeLabel ?? ''),
          );
          // 「翌週水曜」が木曜に出ていると、設定を間違えたのか休業日で動いたのかが
          // 画面から読み取れない。動いたなら理由を添える。
          if (item2.noticeMovedFrom !== undefined) {
            row.append(
              h(
                'span',
                { class: 'preview-note' },
                `${dayLabel(item2.noticeMovedFrom)}が休業日のため`,
              ),
            );
          }
          chain.append(row);
        }
        // 消さずに、その回ごとに「計算できません」と理由を残す。
        for (const { notice, detail } of missing) {
          chain.append(
            h(
              'li',
              { class: 'preview-related-item is-unresolved' },
              h('span', { class: 'preview-related-mark' }, '—'),
              h('span', { class: 'preview-date' }, '計算できません'),
              h('span', { class: 'preview-related-label' }, `${notice.label}: ${detail}`),
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
    const stateIssues = this.noticeStateIssues();
    const issues = validateRule(this.draft);
    if (stateIssues.length > 0 || issues.some((issue) => issue.severity === 'error')) {
      this.refresh();
      this.focusFirstProblem(stateIssues);
      return;
    }
    this.handlers.onSave({ ...structuredClone(this.draft), updatedAt: new Date().toISOString() });
  }

  /**
   * 直すべき欄へ運ぶ。
   *
   * フォームの先頭の入力欄へ移していたため、前後の予定を何件も持っていると
   * 「どこがおかしいのか」が分からなかった。悪いのが前後の予定なら、
   * その予定の欄まで運ぶ。畳んであるときは開いてから運ぶ。
   */
  private focusFirstProblem(stateIssues: readonly { index: number; field: 'size' }[]): void {
    const first = stateIssues[0];
    if (first !== undefined) {
      const item = this.element.querySelectorAll('.notice-item')[first.index];
      // 行の先頭ではなく、悪い値が入っている欄そのものへ運ぶ。
      const target = item?.querySelector<HTMLElement>(`[data-field="${first.field}"]`);
      if (target !== null && target !== undefined) {
        target.closest('details')?.setAttribute('open', '');
        target.focus();
        scrollIntoView(target, 'center');
        return;
      }
    }
    const invalid = this.element.querySelector<HTMLElement>('[aria-invalid="true"]');
    (invalid ?? this.element.querySelector<HTMLElement>('input, select, textarea'))?.focus();
  }
}
