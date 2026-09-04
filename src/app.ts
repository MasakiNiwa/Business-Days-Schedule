/**
 * アプリ本体。状態の保持と再描画をまとめる。
 *
 * M2 の範囲は「月カレンダー表示」と「ルール一覧（読み取り専用）」。
 * ルールの編集は M3、一覧表示・入出力 UI は M4 で追加する。
 */

import {
  createBusinessDayCalendar,
  COMPANY_CALENDAR_ID,
} from './core/businessDay';
import type { BusinessDayCalendar } from './core/businessDay';
import { monthOf, todayInTokyo, yearOf } from './core/dateUtil';
import { createHolidayLookup, fetchHolidayData } from './core/holidays';
import type { HolidayLookup } from './core/holidays';
import { buildMonthGrid, gridRangeOf, shiftMonth } from './core/monthGrid';
import { expandRules, groupByDate } from './core/schedule';
import type { ScheduleContext } from './core/schedule';
import { importState, loadState, resolveStore, saveState } from './core/storage';
import type { AppState, KeyValueStore } from './core/storage';
import type { BusinessCalendar, Month, Rule } from './types';
import { renderCalendar, renderLegend } from './ui/CalendarView';
import { h, clear } from './ui/dom';
import { renderRuleList } from './ui/RuleList';

const HOLIDAYS_URL = `${import.meta.env.BASE_URL}data/holidays.json`;
const SAMPLES_URL = `${import.meta.env.BASE_URL}data/samples/business-basics.json`;

type ViewState = {
  year: number;
  month: Month;
};

export class App {
  private state: AppState;
  private view: ViewState;
  private readonly today: string;
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

  /** calendarId → 営業日カレンダー。祝日データと結び付けて毎回作り直す。 */
  private businessCalendars(): Map<string, BusinessDayCalendar> {
    return new Map(
      this.state.calendars.map((calendar) => [
        calendar.id,
        createBusinessDayCalendar(calendar, this.holidays),
      ]),
    );
  }

  private scheduleContext(calendars: Map<string, BusinessDayCalendar>): ScheduleContext {
    // 既定カレンダーが削除されている場合に備え、先頭のカレンダーへフォールバックする。
    const fallback = calendars.has(COMPANY_CALENDAR_ID)
      ? COMPANY_CALENDAR_ID
      : ([...calendars.keys()][0] ?? COMPANY_CALENDAR_ID);
    return { calendars, fallbackCalendarId: fallback };
  }

  private goToMonth(count: number): void {
    this.view = { ...this.view, ...shiftMonth(this.view.year, this.view.month, count) };
    this.render();
  }

  private goToToday(): void {
    this.view = { year: yearOf(this.today), month: monthOf(this.today) };
    this.render();
  }

  private async loadSamples(): Promise<void> {
    try {
      const response = await fetch(SAMPLES_URL);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const result = importState(await response.json(), this.state, 'replace');
      if (!result.ok) throw new Error(result.errors.join(' / '));
      this.state = result.state;
      saveState(this.store, this.state);
      this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.render(`サンプルの読み込みに失敗しました: ${message}`);
    }
  }

  private renderHeader(): HTMLElement {
    const prev = h('button', { type: 'button', class: 'nav', 'aria-label': '前の月' }, '‹');
    const next = h('button', { type: 'button', class: 'nav', 'aria-label': '次の月' }, '›');
    const today = h('button', { type: 'button', class: 'button button-sm' }, '今日');
    prev.addEventListener('click', () => this.goToMonth(-1));
    next.addEventListener('click', () => this.goToMonth(1));
    today.addEventListener('click', () => this.goToToday());

    return h(
      'header',
      { class: 'app-header' },
      h(
        'div',
        { class: 'month-nav' },
        prev,
        h('h1', { class: 'month-label' }, `${this.view.year}年${this.view.month}月`),
        next,
        today,
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
        h(
          'a',
          { href: 'https://github.com/MasakiNiwa/Business-Days-Schedule' },
          'GitHub リポジトリ',
        ),
      ),
    );
  }

  render(errorMessage?: string): void {
    const calendars = this.businessCalendars();
    const ctx = this.scheduleContext(calendars);
    const range = gridRangeOf(this.view.year, this.view.month);
    const { occurrences, warnings } = expandRules(this.state.rules, range, ctx);

    // 日付セルの休業表示は既定カレンダーを基準にする。
    // loadState / importState がカレンダーを空にしないため、ここは必ず解決できる。
    const baseCalendar = calendars.get(ctx.fallbackCalendarId);
    if (baseCalendar === undefined) throw new Error('営業日カレンダーが1件もありません');

    const grid = buildMonthGrid(this.view.year, this.view.month, {
      calendar: baseCalendar,
      holidays: this.holidays,
      occurrencesByDate: groupByDate(occurrences),
      today: this.today,
    });

    const rulesById = new Map<string, Rule>(this.state.rules.map((rule) => [rule.id, rule]));
    const calendarDefs = new Map<string, BusinessCalendar>(
      this.state.calendars.map((item) => [item.id, item]),
    );

    const notices: string[] = [];
    if (!this.storeAvailable) {
      notices.push('この端末には保存されません（ブラウザの設定により localStorage が使えません）');
    }
    if (this.holidays.isOutOfRange(range.start) || this.holidays.isOutOfRange(range.end)) {
      notices.push('この月は祝日データの収録範囲外です。休業日の判定が不正確な可能性があります');
    }
    for (const warning of warnings) notices.push(warning.message);

    clear(this.root);
    this.root.append(
      this.renderHeader(),
      ...(errorMessage === undefined ? [] : [h('p', { class: 'banner banner-error' }, errorMessage)]),
      ...[...new Set(notices)].map((message) => h('p', { class: 'banner' }, message)),
      h(
        'div',
        { class: 'layout' },
        h(
          'section',
          { class: 'calendar-pane', 'aria-label': '月カレンダー' },
          renderCalendar(grid, rulesById),
          renderLegend(occurrences.some((occurrence) => occurrence.kind === 'notice')),
        ),
        renderRuleList(this.state.rules, calendarDefs, {
          onLoadSamples: () => void this.loadSamples(),
        }),
      ),
      this.renderFooter(),
    );
  }
}

export async function startApp(root: HTMLElement): Promise<void> {
  try {
    const data = await fetchHolidayData(HOLIDAYS_URL);
    new App(root, createHolidayLookup(data)).render();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    clear(root);
    root.append(
      h('h1', {}, 'Business Days Schedule'),
      h(
        'p',
        { class: 'banner banner-error' },
        `祝日データを読み込めなかったため表示できません: ${message}`,
      ),
    );
  }
}
