/**
 * アプリ本体。状態の保持と再描画をまとめる。
 *
 * 画面は「カレンダー」「ルール編集」「設定」の3モード。編集中はカレンダーを
 * 隠さず横に並べ、変更の影響をその場で見られるようにする。
 */

import { createBusinessDayCalendar, COMPANY_CALENDAR_ID } from './core/businessDay';
import type { BusinessDayCalendar } from './core/businessDay';
import { monthOf, todayInTokyo, yearOf } from './core/dateUtil';
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
import { button } from './ui/controls';
import { clear, h } from './ui/dom';
import { RuleEditor } from './ui/RuleEditor';
import { renderRuleList } from './ui/RuleList';
import { SettingsView } from './ui/SettingsView';

const HOLIDAYS_URL = `${import.meta.env.BASE_URL}data/holidays.json`;
const SAMPLES_URL = `${import.meta.env.BASE_URL}data/samples/business-basics.json`;

type Mode =
  | { kind: 'calendar' }
  | { kind: 'edit'; rule: Rule; isNew: boolean }
  | { kind: 'settings' };

export class App {
  private state: AppState;
  private view: { year: number; month: Month };
  private mode: Mode = { kind: 'calendar' };
  private flash: { text: string; tone: 'info' | 'error' } | null = null;

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

  private goToMonth(count: number): void {
    this.view = { ...this.view, ...shiftMonth(this.view.year, this.view.month, count) };
    this.render();
  }

  private goToToday(): void {
    this.view = { year: yearOf(this.today), month: monthOf(this.today) };
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

    return h(
      'header',
      { class: 'app-header' },
      h(
        'div',
        { class: 'month-nav' },
        prev,
        h('h1', { class: 'month-label' }, `${this.view.year}年${this.view.month}月`),
        next,
        button('今日', () => this.goToToday(), 'button button-sm'),
      ),
    );
  }

  private renderFooter(): HTMLElement {
    const meta = this.holidays.meta;
    return h(
      'footer',
      { class: 'app-footer' },
      h(
        'p',
        {},
        `祝日データ: ${meta.source}（${meta.range.from} 〜 ${meta.range.to} / ${meta.count} 件 / 取得 ${meta.fetchedAt.slice(0, 10)}）`,
      ),
      h(
        'p',
        {},
        h('a', { href: 'https://github.com/MasakiNiwa/Business-Days-Schedule' }, 'GitHub リポジトリ'),
      ),
    );
  }

  /** 右側のパネル。モードによって一覧・編集・設定を出し分ける。 */
  private renderSidePanel(
    ctx: ScheduleContext,
    calendarDefs: Map<string, BusinessCalendar>,
  ): HTMLElement {
    if (this.mode.kind === 'edit') {
      const editor = new RuleEditor(
        this.mode.rule,
        this.state.calendars,
        ctx,
        {
          onSave: (rule) => this.saveRule(rule),
          onCancel: () => {
            this.mode = { kind: 'calendar' };
            this.render();
          },
          onDelete: (ruleId) => this.deleteRule(ruleId),
        },
        this.mode.isNew,
        this.today,
      );
      return h('div', { class: 'panel' }, editor.element);
    }

    if (this.mode.kind === 'settings') {
      const settings = new SettingsView(
        this.state.calendars,
        this.holidays,
        {
          onChange: (calendars) => {
            this.state.calendars = calendars;
            this.persist();
            // カレンダーの変更は営業日の判定に直結するので、その場でカレンダーを描き直す。
            this.renderCalendarPaneOnly();
          },
          onExport: () => this.exportJson(),
          onImport: (file, mode) => void this.importJson(file, mode),
          onClearAll: () => this.clearAll(),
          onClose: () => {
            this.mode = { kind: 'calendar' };
            this.render();
          },
        },
        this.today,
      );
      return h('div', { class: 'panel' }, settings.element);
    }

    return renderRuleList(this.state.rules, calendarDefs, {
      onLoadSamples: () => void this.loadSamples(),
      onAdd: () => this.startAdd(),
      onEdit: (ruleId) => this.startEdit(ruleId),
      onToggle: (ruleId, enabled) => this.toggleRule(ruleId, enabled),
      onOpenSettings: () => {
        this.mode = { kind: 'settings' };
        this.render();
      },
    });
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
    const hasNotice = [...occurrencesByDate.values()]
      .flat()
      .some((occurrence) => occurrence.kind === 'notice');

    return h(
      'section',
      { class: 'calendar-pane', 'aria-label': '月カレンダー' },
      renderCalendar(grid, rulesById),
      renderLegend(hasNotice),
    );
  }

  render(): void {
    const calendars = this.businessCalendars();
    const ctx = this.scheduleContext(calendars);
    const { occurrencesByDate, warnings } = this.buildOccurrences();
    const range = gridRangeOf(this.view.year, this.view.month);

    const notices: string[] = [];
    if (!this.storeAvailable) {
      notices.push('この端末には保存されません（ブラウザの設定により localStorage が使えません）');
    }
    if (this.holidays.isOutOfRange(range.start) || this.holidays.isOutOfRange(range.end)) {
      notices.push('この月は祝日データの収録範囲外です。休業日の判定が不正確な可能性があります');
    }
    for (const warning of warnings) notices.push(warning.message);

    const calendarDefs = new Map<string, BusinessCalendar>(
      this.state.calendars.map((item) => [item.id, item]),
    );

    const flash = this.flash;
    this.flash = null;

    clear(this.root);
    this.root.append(
      this.renderHeader(),
      ...(flash === null
        ? []
        : [h('p', { class: `banner${flash.tone === 'error' ? ' banner-error' : ' banner-ok'}` }, flash.text)]),
      ...[...new Set(notices)].map((message) => h('p', { class: 'banner' }, message)),
      h(
        'div',
        { class: `layout${this.mode.kind === 'calendar' ? '' : ' layout-wide-panel'}` },
        this.buildCalendarPane(occurrencesByDate),
        this.renderSidePanel(ctx, calendarDefs),
      ),
      this.renderFooter(),
    );
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
