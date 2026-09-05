/**
 * アプリ本体。状態の保持と再描画をまとめる。
 *
 * 画面は「カレンダー」「ルール編集」「設定」の3モード。編集中はカレンダーを
 * 隠さず横に並べ、変更の影響をその場で見られるようにする。
 */

import { createBusinessDayCalendar, COMPANY_CALENDAR_ID } from './core/businessDay';
import type { BusinessDayCalendar } from './core/businessDay';
import { addDays, lastDayOfMonth, monthOf, todayInTokyo, yearOf } from './core/dateUtil';
import { select } from './ui/controls';
import { createHolidayLookup, fetchHolidayData } from './core/holidays';
import type { HolidayLookup } from './core/holidays';
import { buildMonthGrid, gridRangeOf, shiftMonth } from './core/monthGrid';
import { expandRules, groupByDate } from './core/schedule';
import type { ScheduleContext } from './core/schedule';
import {
  buildExportFile,
  clearState,
  createDefaultState,
  createRule,
  exportFileName,
  importState,
  loadState,
  resolveStore,
  saveState,
} from './core/storage';
import type { AppState, KeyValueStore } from './core/storage';
import type { BusinessCalendar, DateStr, Month, Rule } from './types';
import { renderCalendar, renderLegend } from './ui/CalendarView';
import { renderDayDetail } from './ui/DayDetail';
import { renderHelp } from './ui/HelpView';
import { LIST_RANGES, renderList } from './ui/ListView';
import { applyTheme, nextTheme, themeIcon, themeLabel } from './ui/theme';
import { button } from './ui/controls';
import { createDialog } from './ui/dialog';
import type { DialogController } from './ui/dialog';
import { clear, h } from './ui/dom';
import { RuleEditor } from './ui/RuleEditor';
import { renderRuleList } from './ui/RuleList';
import { SettingsView } from './ui/SettingsView';

const HOLIDAYS_URL = `${import.meta.env.BASE_URL}data/holidays.json`;
const SAMPLES_URL = `${import.meta.env.BASE_URL}data/samples/business-basics.json`;

type Mode =
  | { kind: 'calendar' }
  | { kind: 'rules' }
  | { kind: 'edit'; rule: Rule; isNew: boolean }
  | { kind: 'settings' }
  | { kind: 'help' }
  | { kind: 'day'; date: DateStr };

/** 開いているダイアログの中身を作り直してよいかの判定に使う。 */
function dialogKeyOf(mode: Mode): string | null {
  switch (mode.kind) {
    case 'calendar':
      return null;
    case 'edit':
      return `edit:${mode.rule.id}`;
    case 'day':
      return `day:${mode.date}`;
    default:
      return mode.kind;
  }
}

export class App {
  private state: AppState;
  private view: { year: number; month: Month };
  private mode: Mode = { kind: 'calendar' };
  private flash: { text: string; tone: 'info' | 'error' } | null = null;
  private dialog: DialogController | null = null;
  private dialogKey: string | null = null;

  private readonly today: DateStr;
  private readonly store: KeyValueStore;
  private readonly storeAvailable: boolean;

  constructor(
    private readonly root: HTMLElement,
    private readonly holidays: HolidayLookup,
  ) {
    const resolved = resolveStore();
    this.store = resolved.store;
    this.storeAvailable = resolved.available;
    this.state = loadState(this.store);
    this.today = todayInTokyo();
    this.view = { year: yearOf(this.today), month: monthOf(this.today) };
    applyTheme(this.state.prefs.theme);
  }

  // -------------------------------------------------------------------------
  // 状態
  // -------------------------------------------------------------------------

  private businessCalendars(): Map<string, BusinessDayCalendar> {
    return new Map(
      this.state.calendars.map((calendar) => [
        calendar.id,
        createBusinessDayCalendar(calendar, this.holidays),
      ]),
    );
  }

  private scheduleContext(calendars: Map<string, BusinessDayCalendar>): ScheduleContext {
    const fallback = calendars.has(COMPANY_CALENDAR_ID)
      ? COMPANY_CALENDAR_ID
      : ([...calendars.keys()][0] ?? COMPANY_CALENDAR_ID);
    return { calendars, fallbackCalendarId: fallback };
  }

  private persist(): void {
    saveState(this.store, this.state);
  }

  private notify(text: string, tone: 'info' | 'error' = 'info'): void {
    this.flash = { text, tone };
  }

  // -------------------------------------------------------------------------
  // 操作
  // -------------------------------------------------------------------------

  private setView(view: 'calendar' | 'list'): void {
    this.state.prefs = { ...this.state.prefs, defaultView: view };
    this.persist();
    this.render();
  }

  private setListDays(days: number): void {
    this.state.prefs = { ...this.state.prefs, listDays: days };
    this.persist();
    this.render();
  }

  private goToMonth(count: number): void {
    this.view = { ...this.view, ...shiftMonth(this.view.year, this.view.month, count) };
    this.render();
  }

  private goToToday(): void {
    this.view = { year: yearOf(this.today), month: monthOf(this.today) };
    this.render();
  }

  private cycleTheme(): void {
    this.state.prefs = { ...this.state.prefs, theme: nextTheme(this.state.prefs.theme) };
    applyTheme(this.state.prefs.theme);
    this.persist();
    this.render();
  }

  private selectDay(date: DateStr): void {
    // 同じ日をもう一度押したら閉じる。
    this.mode =
      this.mode.kind === 'day' && this.mode.date === date
        ? { kind: 'calendar' }
        : { kind: 'day', date };
    this.render();
  }

  private moveSelectedDay(days: number): void {
    if (this.mode.kind !== 'day') return;
    const date = addDays(this.mode.date, days);
    this.mode = { kind: 'day', date };
    // 月をまたいだら表示月も合わせる。
    this.view = { year: yearOf(date), month: monthOf(date) };
    this.render();
  }

  private startAdd(): void {
    const calendarId = this.state.calendars[0]?.id ?? COMPANY_CALENDAR_ID;
    this.mode = { kind: 'edit', rule: createRule({ calendarId }), isNew: true };
    this.render();
  }

  private startEdit(ruleId: string): void {
    const rule = this.state.rules.find((item) => item.id === ruleId);
    if (rule === undefined) return;
    this.mode = { kind: 'edit', rule, isNew: false };
    this.render();
  }

  private saveRule(rule: Rule): void {
    const index = this.state.rules.findIndex((item) => item.id === rule.id);
    if (index === -1) this.state.rules = [...this.state.rules, rule];
    else this.state.rules = this.state.rules.map((item) => (item.id === rule.id ? rule : item));
    this.persist();
    this.mode = { kind: 'calendar' };
    this.notify(`「${rule.title}」を保存しました。`);
    this.render();
  }

  private deleteRule(ruleId: string): void {
    const rule = this.state.rules.find((item) => item.id === ruleId);
    if (rule === undefined) return;
    if (!globalThis.confirm(`「${rule.title}」を削除します。よろしいですか？`)) return;
    this.state.rules = this.state.rules.filter((item) => item.id !== ruleId);
    this.persist();
    this.mode = { kind: 'calendar' };
    this.notify(`「${rule.title}」を削除しました。`);
    this.render();
  }

  private toggleRule(ruleId: string, enabled: boolean): void {
    this.state.rules = this.state.rules.map((rule) =>
      rule.id === ruleId ? { ...rule, enabled, updatedAt: new Date().toISOString() } : rule,
    );
    this.persist();
    this.render();
  }

  private async loadSamples(): Promise<void> {
    try {
      const response = await fetch(SAMPLES_URL);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const result = importState(await response.json(), this.state, 'replace');
      if (!result.ok) throw new Error(result.errors.join(' / '));
      this.state = result.state;
      this.persist();
      this.notify('サンプルを読み込みました。');
    } catch (error) {
      this.notify(`サンプルの読み込みに失敗しました: ${messageOf(error)}`, 'error');
    }
    this.render();
  }

  private exportJson(): void {
    const blob = new Blob([JSON.stringify(buildExportFile(this.state), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: exportFileName() });
    link.click();
    // Blob URL は明示的に解放しないとページを離れるまで残る。
    URL.revokeObjectURL(url);
    this.notify('エクスポートしました。');
    this.render();
  }

  private async importJson(file: File, mode: 'replace' | 'merge'): Promise<void> {
    try {
      const result = importState(JSON.parse(await file.text()), this.state, mode);
      if (!result.ok) throw new Error(result.errors.join(' / '));
      this.state = result.state;
      this.persist();
      const skipped = result.skipped.rules + result.skipped.calendars;
      this.notify(
        skipped === 0
          ? 'インポートしました。'
          : `インポートしました（形式が不正な ${skipped} 件は取り込みませんでした）。`,
      );
      this.mode = { kind: 'calendar' };
    } catch (error) {
      this.notify(`インポートに失敗しました: ${messageOf(error)}`, 'error');
    }
    this.render();
  }

  private clearAll(): void {
    if (!globalThis.confirm('ルールとカレンダー設定をこの端末から削除します。取り消せません。')) {
      return;
    }
    clearState(this.store);
    this.state = createDefaultState();
    this.mode = { kind: 'calendar' };
    this.notify('すべて削除しました。');
    this.render();
  }

  // -------------------------------------------------------------------------
  // 描画
  // -------------------------------------------------------------------------

  private renderHeader(): HTMLElement {
    const prev = button('‹', () => this.goToMonth(-1), 'nav');
    prev.setAttribute('aria-label', '前の月');
    const next = button('›', () => this.goToMonth(1), 'nav');
    next.setAttribute('aria-label', '次の月');

    const theme = this.state.prefs.theme;
    const themeButton = button(themeIcon(theme), () => this.cycleTheme(), 'nav');
    themeButton.setAttribute('aria-label', `配色: ${themeLabel(theme)}（クリックで切り替え）`);
    themeButton.setAttribute('title', `配色: ${themeLabel(theme)}`);

    const rulesButton = button('ルール', () => this.openMode('rules'), 'button button-sm');
    rulesButton.setAttribute('title', 'ルールの一覧・追加');
    if (this.mode.kind === 'rules') rulesButton.setAttribute('aria-pressed', 'true');

    const settingsButton = button('⚙', () => this.openMode('settings'), 'nav');
    settingsButton.setAttribute('aria-label', '設定');
    settingsButton.setAttribute('title', '設定');
    if (this.mode.kind === 'settings') settingsButton.setAttribute('aria-pressed', 'true');

    const helpButton = button('?', () => this.openMode('help'), 'nav');
    helpButton.setAttribute('aria-label', 'ヘルプ');
    helpButton.setAttribute('title', 'ヘルプ');
    if (this.mode.kind === 'help') helpButton.setAttribute('aria-pressed', 'true');

    const isList = this.state.prefs.defaultView === 'list';

    const viewToggle = h('div', { class: 'segmented', role: 'group', 'aria-label': '表示の切り替え' });
    for (const [value, label] of [['calendar', 'カレンダー'], ['list', '一覧']] as const) {
      const item = h(
        'button',
        {
          type: 'button',
          class: 'segment',
          'aria-pressed': this.state.prefs.defaultView === value ? 'true' : 'false',
        },
        label,
      );
      item.addEventListener('click', () => this.setView(value));
      viewToggle.append(item);
    }

    const left = isList
      ? h(
          'div',
          { class: 'month-nav' },
          h('h1', { class: 'month-label' }, '今後の予定'),
          select(
            LIST_RANGES.map((days) => ({ value: String(days), label: `${days}日先まで` })),
            String(this.state.prefs.listDays),
            (value) => this.setListDays(Number(value)),
          ),
        )
      : h(
          'div',
          { class: 'month-nav' },
          prev,
          h('h1', { class: 'month-label' }, `${this.view.year}年${this.view.month}月`),
          next,
          button('今日', () => this.goToToday(), 'button button-sm'),
        );

    return h(
      'header',
      { class: 'app-header' },
      left,
      h(
        'div',
        { class: 'header-actions' },
        viewToggle,
        rulesButton,
        themeButton,
        settingsButton,
        helpButton,
      ),
    );
  }

  /** ヘッダーのボタンはトグル動作にする。同じボタンをもう一度押せば閉じる。 */
  private openMode(kind: 'settings' | 'help' | 'rules'): void {
    this.mode = this.mode.kind === kind ? { kind: 'calendar' } : { kind };
    this.render();
  }

  private backToCalendar(): void {
    this.mode = { kind: 'calendar' };
    this.render();
  }

  private renderFooter(): HTMLElement {
    const meta = this.holidays.meta;
    return h(
      'footer',
      { class: 'app-footer' },
      h(
        'p',
        { class: 'footer-source' },
        `祝日データ: ${meta.source}（${meta.range.from} 〜 ${meta.range.to} / ${meta.count} 件 / 取得 ${meta.fetchedAt.slice(0, 10)}）`,
      ),
      h(
        'p',
        { class: 'footer-link' },
        h('a', { href: 'https://github.com/MasakiNiwa/Business-Days-Schedule' }, 'GitHub リポジトリ'),
      ),
    );
  }

  /** ダイアログの中身。モードによって出し分ける。 */
  private buildDialogContent(mode: Mode): HTMLElement | null {
    const calendarDefs = new Map<string, BusinessCalendar>(
      this.state.calendars.map((item) => [item.id, item]),
    );

    if (mode.kind === 'edit') {
      const editor = new RuleEditor(
        mode.rule,
        this.state.calendars,
        this.scheduleContext(this.businessCalendars()),
        {
          onSave: (rule) => this.saveRule(rule),
          onCancel: () => this.backToCalendar(),
          onDelete: (ruleId) => this.deleteRule(ruleId),
        },
        mode.isNew,
        this.today,
      );
      return editor.element;
    }

    if (mode.kind === 'settings') {
      const settings = new SettingsView(
        this.state.calendars,
        this.holidays,
        {
          onChange: (calendars) => {
            this.state.calendars = calendars;
            this.persist();
            // カレンダーの変更は営業日の判定に直結するので、背面のカレンダーだけ描き直す。
            this.renderCalendarPaneOnly();
          },
          onExport: () => this.exportJson(),
          onImport: (file, mode2) => void this.importJson(file, mode2),
          onClearAll: () => this.clearAll(),
          onClose: () => this.backToCalendar(),
        },
        this.today,
      );
      return settings.element;
    }

    if (mode.kind === 'help') {
      return renderHelp(() => this.backToCalendar());
    }

    if (mode.kind === 'day') {
      const calendars = this.businessCalendars();
      const ctx = this.scheduleContext(calendars);
      const businessCalendar = calendars.get(ctx.fallbackCalendarId);
      if (businessCalendar === undefined) throw new Error('営業日カレンダーが1件もありません');
      const occurrences = this.buildOccurrences().occurrencesByDate.get(mode.date) ?? [];
      return renderDayDetail(
        mode.date,
        occurrences,
        new Map(this.state.rules.map((rule) => [rule.id, rule])),
        calendarDefs,
        businessCalendar,
        this.holidays,
        {
          onClose: () => this.backToCalendar(),
          onEditRule: (ruleId) => this.startEdit(ruleId),
          onMove: (days) => this.moveSelectedDay(days),
        },
      );
    }

    if (mode.kind === 'rules') {
      return renderRuleList(this.state.rules, calendarDefs, {
        onLoadSamples: () => void this.loadSamples(),
        onAdd: () => this.startAdd(),
        onEdit: (ruleId) => this.startEdit(ruleId),
        onToggle: (ruleId, enabled) => this.toggleRule(ruleId, enabled),
        onOpenSettings: () => {
          this.mode = { kind: 'settings' };
          this.render();
        },
        onClose: () => this.backToCalendar(),
      });
    }

    return null;
  }

  /**
   * モードに合わせてダイアログを開閉する。
   *
   * 編集中は同じルールを開いている限り中身を作り直さない。作り直すと入力途中の
   * 下書きとフォーカスを失うため。
   */
  private syncDialog(): void {
    const key = dialogKeyOf(this.mode);

    if (key === null) {
      this.dialog?.element.remove();
      this.dialog?.close();
      this.dialog = null;
      this.dialogKey = null;
      return;
    }

    const isSameEditor = key === this.dialogKey && this.mode.kind === 'edit';
    if (this.dialog !== null && isSameEditor) return;

    const content = this.buildDialogContent(this.mode);
    if (content === null) return;

    const size = this.mode.kind === 'edit' || this.mode.kind === 'settings' ? 'lg' : 'md';

    if (this.dialog !== null && key === this.dialogKey) {
      this.dialog.setContent(content);
      return;
    }

    // 種類が変わるときは開き直す。サイズと初期フォーカスを取り直すため。
    if (this.dialog !== null) {
      const previous = this.dialog;
      this.dialog = null;
      previous.element.remove();
    }

    this.dialog = createDialog(content, () => this.onDialogClosed(), size);
    this.dialogKey = key;
  }

  /** ブラウザ側の操作（Esc・背景クリック）で閉じられたときの後始末。 */
  private onDialogClosed(): void {
    if (this.dialog === null) return;
    this.dialog.element.remove();
    this.dialog = null;
    this.dialogKey = null;
    if (this.mode.kind !== 'calendar') {
      this.mode = { kind: 'calendar' };
      this.render();
    }
  }

  /** 設定変更のたびに右パネルごと作り直すと入力位置を失うため、左側だけ差し替える。 */
  private renderCalendarPaneOnly(): void {
    const existing = this.root.querySelector('.calendar-pane');
    if (existing === null) {
      this.render();
      return;
    }
    const replacement = this.buildCalendarPane(this.buildOccurrences().occurrencesByDate);
    existing.replaceWith(replacement);
  }

  private buildOccurrences(): {
    occurrencesByDate: Map<DateStr, ReturnType<typeof expandRules>['occurrences']>;
    warnings: ReturnType<typeof expandRules>['warnings'];
    hasNotice: boolean;
  } {
    const ctx = this.scheduleContext(this.businessCalendars());
    const range = gridRangeOf(this.view.year, this.view.month);
    const { occurrences, warnings } = expandRules(this.state.rules, range, ctx);
    return {
      occurrencesByDate: groupByDate(occurrences),
      warnings,
      hasNotice: occurrences.some((occurrence) => occurrence.kind === 'notice'),
    };
  }

  private buildCalendarPane(
    occurrencesByDate: Map<DateStr, ReturnType<typeof expandRules>['occurrences']>,
  ): HTMLElement {
    const calendars = this.businessCalendars();
    const ctx = this.scheduleContext(calendars);
    const baseCalendar = calendars.get(ctx.fallbackCalendarId);
    if (baseCalendar === undefined) throw new Error('営業日カレンダーが1件もありません');

    const grid = buildMonthGrid(this.view.year, this.view.month, {
      calendar: baseCalendar,
      holidays: this.holidays,
      occurrencesByDate,
      today: this.today,
    });

    const rulesById = new Map<string, Rule>(this.state.rules.map((rule) => [rule.id, rule]));
    const all = [...occurrencesByDate.values()].flat();
    const hasNotice = all.some((occurrence) => occurrence.kind === 'notice');
    const hasShift = all.some((occurrence) => occurrence.shifted);
    const selectedDate = this.mode.kind === 'day' ? this.mode.date : null;

    const businessDays = baseCalendar.businessDaysOfMonth(this.view.year, this.view.month).length;
    const totalDays = lastDayOfMonth(this.view.year, this.view.month);

    return h(
      'section',
      { class: 'calendar-pane', 'aria-label': '月カレンダー' },
      h('p', { class: 'print-title' }, `${this.view.year}年${this.view.month}月`),
      h(
        'p',
        { class: 'month-summary' },
        `${baseCalendar.name}: 営業日 ${businessDays}日 / 休業日 ${totalDays - businessDays}日`,
      ),
      renderCalendar(grid, rulesById, { onSelectDay: (date) => this.selectDay(date) }, selectedDate),
      renderLegend(hasNotice, hasShift),
    );
  }

  /** ルールが1件も無いときの導線。カレンダーだけでは何もできないため。 */
  private renderEmptyPrompt(): HTMLElement {
    return h(
      'div',
      { class: 'empty-prompt' },
      h('p', {}, 'まだルールがありません。'),
      h(
        'div',
        { class: 'empty-prompt-actions' },
        button('サンプルを読み込む', () => void this.loadSamples(), 'button button-primary'),
        button('ルールを追加', () => this.startAdd(), 'button'),
      ),
      h(
        'p',
        { class: 'field-hint' },
        '給与振込・月次締め・第5営業日の請求書発行など、実務でよく使う8件から始められます。',
      ),
    );
  }

  /** 一覧表示（§8.3）。今日から prefs.listDays 日ぶんを時系列で並べる。 */
  private buildListPane(): HTMLElement {
    const days = this.state.prefs.listDays;
    const calendars = this.businessCalendars();
    const ctx = this.scheduleContext(calendars);
    const businessCalendar = calendars.get(ctx.fallbackCalendarId);
    if (businessCalendar === undefined) throw new Error('営業日カレンダーが1件もありません');

    const { occurrences } = expandRules(
      this.state.rules,
      { start: this.today, end: addDays(this.today, days - 1) },
      ctx,
    );

    return renderList(
      occurrences,
      new Map(this.state.rules.map((rule) => [rule.id, rule])),
      new Map(this.state.calendars.map((item) => [item.id, item])),
      businessCalendar,
      this.holidays,
      this.today,
      days,
      this.today,
      {
        onEditRule: (ruleId) => this.startEdit(ruleId),
        onSelectDay: (date) => this.selectDay(date),
      },
    );
  }

  render(): void {
    const range = gridRangeOf(this.view.year, this.view.month);
    const { occurrencesByDate, warnings } = this.buildOccurrences();

    const notices: string[] = [];
    if (!this.storeAvailable) {
      notices.push('この端末には保存されません（ブラウザの設定により localStorage が使えません）');
    }
    if (this.holidays.isOutOfRange(range.start) || this.holidays.isOutOfRange(range.end)) {
      notices.push('この月は祝日データの収録範囲外です。休業日の判定が不正確な可能性があります');
    }
    for (const warning of warnings) notices.push(warning.message);

    const flash = this.flash;
    this.flash = null;

    clear(this.root);
    this.root.append(
      this.renderHeader(),
      ...(flash === null
        ? []
        : [
            h(
              'p',
              { class: `banner${flash.tone === 'error' ? ' banner-error' : ' banner-ok'}` },
              flash.text,
            ),
          ]),
      ...[...new Set(notices)].map((message) => h('p', { class: 'banner' }, message)),
      this.state.prefs.defaultView === 'list'
        ? this.buildListPane()
        : this.buildCalendarPane(occurrencesByDate),
      ...(this.state.rules.length === 0 ? [this.renderEmptyPrompt()] : []),
      this.renderFooter(),
    );

    this.syncDialog();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startApp(root: HTMLElement): Promise<void> {
  try {
    const data = await fetchHolidayData(HOLIDAYS_URL);
    new App(root, createHolidayLookup(data)).render();
  } catch (error) {
    clear(root);
    root.append(
      h('h1', {}, 'Business Days Schedule'),
      h(
        'p',
        { class: 'banner banner-error' },
        `祝日データを読み込めなかったため表示できません: ${messageOf(error)}`,
      ),
    );
  }
}
