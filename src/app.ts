/**
 * アプリ本体。状態の保持と再描画をまとめる。
 *
 * 画面は「カレンダー」「ルール編集」「設定」の3モード。編集中はカレンダーを
 * 隠さず横に並べ、変更の影響をその場で見られるようにする。
 */

import { createBusinessDayCalendar, COMPANY_CALENDAR_ID } from './core/businessDay';
import type { BusinessDayCalendar } from './core/businessDay';
import { addDays, lastDayOfMonth, monthOf, todayInTokyo, yearOf } from './core/dateUtil';
import { field, named, select } from './ui/controls';
import { createBundledHolidayLookup, outOfRangeMessage } from './core/holidays';
import type { HolidayLookup } from './core/holidays';
import { buildMonthGrid, gridRangeOf, shiftMonth } from './core/monthGrid';
import {
  UNGROUPED,
  collectGroups,
  filterByGroups,
  groupLabel,
  groupsLabel,
  hasUngrouped,
  renameGroup,
  resolveActiveGroups,
  rulesInGroup,
} from './core/group';
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
import type { HelpAction } from './ui/HelpView';
import { LIST_RANGES, renderList } from './ui/ListView';
import { renderMonthPicker } from './ui/MonthPicker';
import { renderCalendarExport } from './ui/CalendarExportView';
import type { CalendarExportRequest } from './ui/CalendarExportView';
import { renderSamplePicker } from './ui/SamplePicker';
import { parseSampleIndex } from './core/samples';
import type { SamplePack } from './core/samples';
import {
  buildCsv,
  buildIcs,
  exportCalendarFileName,
  exportWarningPrompt,
  MIME_TYPES,
} from './core/exportCalendar';
import { attachHorizontalSwipe } from './ui/swipe';
import { applyTheme, nextTheme, themeIcon, themeLabel } from './ui/theme';
import { APP_NAME, APP_TAGLINE_LEAD, APP_TAGLINE_REST, longVersion, shortVersion } from './core/buildInfo';
import { button } from './ui/controls';
import { createDialog } from './ui/dialog';
import type { DialogController } from './ui/dialog';
import { clear, h } from './ui/dom';
import { RuleEditor } from './ui/RuleEditor';
import { renderRuleList } from './ui/RuleList';
import { SettingsView } from './ui/SettingsView';

const SAMPLES_DIR = `${import.meta.env.BASE_URL}data/samples/`;

type Mode =
  | { kind: 'calendar' }
  | { kind: 'rules' }
  | { kind: 'edit'; rule: Rule; isNew: boolean }
  | { kind: 'settings' }
  | { kind: 'help' }
  | { kind: 'jump' }
  | { kind: 'samples' }
  | { kind: 'calendarExport' }
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
  /** 矢印キーで月をまたいだあと、描き直しの後にフォーカスを戻す先。 */
  private pendingFocusDate: DateStr | null = null;
  private dialog: DialogController | null = null;
  private dialogKey: string | null = null;
  private samplePacks: SamplePack[] | null = null;
  private sampleError: string | null = null;

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
    const loaded = loadState(this.store);
    this.state = { rules: loaded.rules, calendars: loaded.calendars, prefs: loaded.prefs };
    if (loaded.droppedRules > 0 || loaded.droppedCalendars > 0) {
      // 壊れたデータを黙って捨てると、無くなったことに気づけない。
      this.flash = {
        text: `保存データのうち ${loaded.droppedRules + loaded.droppedCalendars} 件が壊れていたため読み込みませんでした。`,
        tone: 'error',
      };
    }
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

  private goToMonthOf(year: number, month: Month): void {
    this.view = { year, month };
    this.mode = { kind: 'calendar' };
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

  /** カレンダー内の矢印キー移動で、表示中の月の外へ出たとき。 */
  private focusDate(date: DateStr): void {
    this.view = { year: yearOf(date), month: monthOf(date) };
    this.pendingFocusDate = date;
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
    // グループで絞って見ているときは、そのグループの続きを足すのが自然。
    // 何も指定せずに作ると、追加した直後に画面から消えて戸惑わせる。
    // 絞り込みが1つだけのときは、その続きを足すのが自然。
    // 複数選んでいるときはどれに入れたいのか決まらないので、指定しない。
    const groups = this.activeGroups();
    const group = groups !== null && groups.length === 1 ? groups[0] : undefined;
    this.mode = {
      kind: 'edit',
      rule: createRule(group === undefined ? { calendarId } : { calendarId, group }),
      isNew: true,
    };
    this.render();
  }

  private startEdit(ruleId: string): void {
    const rule = this.state.rules.find((item) => item.id === ruleId);
    if (rule === undefined) return;
    this.mode = { kind: 'edit', rule, isNew: false };
    this.render();
  }

  /**
   * 既存のルールを写して作り始める。
   *
   * 「25日締め」と「末日締め」のように、1か所だけ違うルールを何本も作ることが多い。
   * 一から組み直させると、営業日カレンダーやグループの指定を写し忘れる。
   *
   * 保存はまだしない。編集画面に出したうえで、名前を直してから保存してもらう。
   * 断りなく増やすと、一覧に似た名前が並んで見分けがつかなくなる。
   */
  private startDuplicate(ruleId: string): void {
    const source = this.state.rules.find((item) => item.id === ruleId);
    if (source === undefined) return;
    const copy = structuredClone(source);
    // 作り直すのは id と日時だけ。既定値ごと被せると、写したはずの
    // 営業日カレンダーや繰り返しまで初期状態へ戻ってしまう。
    const fresh = createRule({});
    this.mode = {
      kind: 'edit',
      rule: {
        ...copy,
        id: fresh.id,
        createdAt: fresh.createdAt,
        updatedAt: fresh.updatedAt,
        title: `${source.title}のコピー`,
        // 前後の予定の識別子も作り直す。同じ id のままだと、書き出したときに
        // 元の予定を上書きしてしまう。
        notices: copy.notices.map(({ id: _id, ...notice }) => notice),
      },
      isNew: true,
    };
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

  /** サンプル一覧を取り込み、選択画面を開く。 */
  private async openSamples(): Promise<void> {
    this.mode = { kind: 'samples' };
    if (this.samplePacks === null && this.sampleError === null) {
      try {
        const response = await fetch(`${SAMPLES_DIR}index.json`);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        this.samplePacks = parseSampleIndex(await response.json());
      } catch (error) {
        this.sampleError = `サンプル一覧を読み込めませんでした: ${messageOf(error)}`;
      }
    }
    this.render();
  }

  /**
   * サンプル束を取り込む。
   *
   * 既定の 'add' は既にある ID を触らない。黙って上書きすると、利用者が編集した
   * 名前や日付が予告なく元へ戻ってしまうため。'merge'（元に戻す）は確認を取る。
   */
  private async addSamplePack(pack: SamplePack, mode: 'add' | 'merge' = 'add', ids?: readonly string[]): Promise<void> {
    if (mode === 'merge') {
      const ok = globalThis.confirm(
        `「${pack.name}」の ${pack.count} 件を、編集前の内容で上書きします。\nこの束のルールに加えた変更は失われます。よろしいですか？`,
      );
      if (!ok) return;
    }

    try {
      const response = await fetch(`${SAMPLES_DIR}${pack.file}`);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const raw = await response.json();
      if (ids !== undefined) {
        if (!Array.isArray(raw?.rules)) throw new Error('サンプルの形式が不正です');
        raw.rules = raw.rules.filter((rule: Rule) => ids.includes(rule.id));
      }
      const result = importState(raw, this.state, mode);
      if (!result.ok) throw new Error(result.errors.join(' / '));
      this.state = result.state;
      this.state.prefs = {
        ...this.state.prefs,
        addedSamplePacks: [...new Set([...this.state.prefs.addedSamplePacks, pack.id])],
      };
      this.persist();

      const { applied, untouched } = result;
      const parts = [`${applied.rules} 件を${mode === 'merge' ? '上書き' : '追加'}`];
      if (untouched.rules > 0) parts.push(`${untouched.rules} 件は既にあるため変更なし`);
      this.notify(`「${pack.name}」: ${parts.join('、')}しました。`);
    } catch (error) {
      this.notify(`「${pack.name}」の取り込みに失敗しました: ${messageOf(error)}`, 'error');
    }
    this.render();
  }

  private exportJson(): void {
    this.download(
      JSON.stringify(buildExportFile(this.state), null, 2),
      'application/json',
      exportFileName(),
    );
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

  /** 書き出し対象の発生日を数える／集める。 */
  private occurrencesBetween(
    from: DateStr,
    to: DateStr,
    groups: string[] | null,
  ): ReturnType<typeof expandRules> {
    return expandRules(
      filterByGroups(this.state.rules, groups),
      { start: from, end: to },
      this.scheduleContext(this.businessCalendars()),
    );
  }

  private exportCalendarFile(request: CalendarExportRequest): void {
    // 収録範囲を外れた期間を黙って書き出すと、誤った日付が他所のカレンダーへ渡る。
    const outOfRange = outOfRangeMessage(this.holidays, request.from, request.to);
    if (outOfRange !== null && !globalThis.confirm(`${outOfRange}\n\nこのまま書き出しますか？`)) {
      return;
    }
    const { occurrences, warnings } = this.occurrencesBetween(
      request.from,
      request.to,
      request.groups,
    );
    // 日付を出せなかった準備日・フォローがあるまま黙って書き出すと、
    // 取り込み先で「設定したのに無い」に気づけない。
    // 出ないものと、出るが確かめてほしいものは分けて伝える。
    const prompt = exportWarningPrompt(warnings, request);
    if (prompt !== null && !globalThis.confirm(`${prompt}\n\nこのまま書き出しますか？`)) {
      return;
    }
    const rules = new Map(this.state.rules.map((rule) => [rule.id, rule]));
    // 取り込み先ではカレンダー名が手掛かりになる。グループごとに別の名前を渡す。
    const label = groupsLabel(request.groups);
    const calendarName = label === null ? APP_NAME : `${APP_NAME} — ${label}`;
    const options = {
      includeNotices: request.includeNotices,
      includeFollows: request.includeFollows,
      calendarName,
    };
    const text =
      request.format === 'ics'
        ? buildIcs(occurrences, rules, options)
        : buildCsv(occurrences, rules, options);

    this.download(
      text,
      MIME_TYPES[request.format],
      exportCalendarFileName(request.from, request.to, request.format, label),
    );
    this.mode = { kind: 'calendar' };
    this.notify(`${request.format.toUpperCase()} を書き出しました。`);
    this.render();
  }

  private download(text: string, mime: string, fileName: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const link = h('a', { href: url, download: fileName });
    link.click();
    URL.revokeObjectURL(url);
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

  /**
   * アプリ名・何をするものか・版。
   *
   * 版は、静的サイトでは「いつのものを見ているか」が分かりにくく、
   * 不具合の報告を受けたときに突き合わせられないと原因を追えないため常に出す。
   */
  private renderBrand(): HTMLElement {
    return h(
      'div',
      { class: 'brand-bar' },
      h(
        'div',
        { class: 'brand-text' },
        h('h1', { class: 'brand' }, APP_NAME),
        h(
          'p',
          { class: 'brand-tagline' },
          // 他のカレンダーには無い部分なので、そこだけ強く出す。
          h('strong', { class: 'brand-tagline-lead' }, APP_TAGLINE_LEAD),
          APP_TAGLINE_REST,
        ),
      ),
      h(
        'span',
        { class: 'brand-version', title: longVersion() },
        shortVersion(),
      ),
    );
  }

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

    // 書き出しはこのアプリの出口なので、設定の中に埋めずヘッダーへ出す。
    const exportButton = button('書き出し', () => this.openMode('calendarExport'), 'button button-sm');
    exportButton.setAttribute('title', 'Outlook / Google カレンダーへ書き出す');
    if (this.mode.kind === 'calendarExport') exportButton.setAttribute('aria-pressed', 'true');

    const settingsButton = button('⚙', () => this.openMode('settings'), 'nav');
    settingsButton.setAttribute('aria-label', '設定');
    settingsButton.setAttribute('title', '設定');
    if (this.mode.kind === 'settings') settingsButton.setAttribute('aria-pressed', 'true');

    // 「?」だけだと、やりたいことから引ける索引があることまでは伝わらない。
    // 広い画面では言葉も出す（狭い画面では記号だけに畳む）。
    const helpButton = button('', () => this.openMode('help'), 'nav nav-help');
    helpButton.append(
      h('span', { class: 'nav-help-mark', 'aria-hidden': 'true' }, '?'),
      h('span', { class: 'nav-help-text' }, '使い方'),
    );
    helpButton.setAttribute('aria-label', '使い方・ヘルプ');
    helpButton.setAttribute('title', '使い方・ヘルプ（やりたいことから探せます）');
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

    // 年月はカレンダーの中央線に合わせたいので、ヘッダーを
    // 「左（今日）／中央（‹ 年月 ›）／右（操作）」の3ゾーンに分ける。
    // 左右を同じ幅にすることで、中央ゾーンがページ＝カレンダーの中央に来る。
    const monthLabel = button(
      `${this.view.year}年${this.view.month}月`,
      () => this.openMode('jump'),
      'month-label',
    );
    monthLabel.setAttribute('title', '月を移動');
    if (this.mode.kind === 'jump') monthLabel.setAttribute('aria-pressed', 'true');

    const center = isList
      ? h(
          'div',
          { class: 'header-center' },
          h('p', { class: 'month-label is-static' }, '今後の予定'),
          named(
            select(
              LIST_RANGES.map((days) => ({ value: String(days), label: `${days}日先まで` })),
              String(this.state.prefs.listDays),
              (value) => this.setListDays(Number(value)),
            ),
            '先読みする日数',
          ),
        )
      : h('div', { class: 'header-center' }, prev, monthLabel, next);

    return h(
      'header',
      { class: 'app-header' },
      h(
        'div',
        { class: 'header-left' },
        isList ? null : button('今日', () => this.goToToday(), 'button button-sm'),
      ),
      center,
      h(
        'div',
        { class: 'header-actions' },
        viewToggle,
        // よく使うものと、たまにしか使わないものを見た目でも分ける。
        h('div', { class: 'action-group' }, rulesButton, exportButton),
        h('div', { class: 'action-group' }, themeButton, settingsButton, helpButton),
      ),
    );
  }

  /** ヘッダーのボタンはトグル動作にする。同じボタンをもう一度押せば閉じる。 */
  private openMode(kind: 'settings' | 'help' | 'rules' | 'jump' | 'calendarExport'): void {
    this.mode = this.mode.kind === kind ? { kind: 'calendar' } : { kind };
    this.render();
  }

  /**
   * ヘルプの「やりたいこと」から、その場で始める。
   *
   * 読んで閉じたあとに操作を探し直させると、そこでまた迷う。
   * 逆引きの答えから、対応する画面へ直接運ぶ。
   */
  private runHelpAction(action: HelpAction): void {
    switch (action) {
      case 'newRule':
        this.startAdd();
        return;
      case 'samples':
        void this.openSamples();
        return;
      case 'settings':
        this.mode = { kind: 'settings' };
        this.render();
        return;
      case 'export':
        this.mode = { kind: 'calendarExport' };
        this.render();
        return;
      case 'rules':
        this.mode = { kind: 'rules' };
        this.render();
        return;
    }
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
      h('p', { class: 'footer-version' }, `${APP_NAME} ${longVersion()}`),
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
        collectGroups(this.state.rules),
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
          onExportCalendar: () => {
            this.mode = { kind: 'calendarExport' };
            this.render();
          },
          onImport: (file, mode2) => void this.importJson(file, mode2),
          onClearAll: () => this.clearAll(),
          onClose: () => this.backToCalendar(),
        },
        this.today,
      );
      return settings.element;
    }

    if (mode.kind === 'help') {
      return renderHelp({
        onClose: () => this.backToCalendar(),
        onAction: (action) => this.runHelpAction(action),
      });
    }

    if (mode.kind === 'samples') {
      return renderSamplePicker(
        this.samplePacks ?? [],
        {
          onAdd: (pack) => void this.addSamplePack(pack, 'add'),
          onRestore: (pack) => void this.addSamplePack(pack, 'merge'),
          onLoadRules: async (pack) => {
            const response = await fetch(`${SAMPLES_DIR}${pack.file}`);
            if (!response.ok) throw new Error('取得できませんでした');
            const result = importState(await response.json(), createDefaultState(), 'add');
            if (!result.ok) throw new Error('形式が不正です');
            return result.state.rules;
          },
          onAddSelected: (pack, ids) => void this.addSamplePack(pack, 'add', ids),
          onClose: () => this.backToCalendar(),
        },
        this.sampleError,
      );
    }

    if (mode.kind === 'calendarExport') {
      return renderCalendarExport(
        {
          onExport: (request) => this.exportCalendarFile(request),
          countOccurrences: (request) =>
            this.occurrencesBetween(request.from, request.to, request.groups).occurrences.filter(
              (occurrence) =>
                occurrence.kind === 'main' ||
                (occurrence.kind === 'notice' ? request.includeNotices : request.includeFollows),
            ).length,
          onClose: () => this.backToCalendar(),
        },
        this.today,
        {
          groups: collectGroups(this.state.rules),
          hasUngrouped: hasUngrouped(this.state.rules),
          activeGroups: this.activeGroups(),
        },
      );
    }

    if (mode.kind === 'jump') {
      return renderMonthPicker(
        this.view,
        { year: yearOf(this.today), month: monthOf(this.today) },
        {
          onSelect: (year, month) => this.goToMonthOf(year, month),
          onToday: () => {
            this.mode = { kind: 'calendar' };
            this.goToToday();
          },
          onClose: () => this.backToCalendar(),
        },
      );
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
        onLoadSamples: () => void this.openSamples(),
        onAdd: () => this.startAdd(),
        onEdit: (ruleId) => this.startEdit(ruleId),
        onDuplicate: (ruleId) => this.startDuplicate(ruleId),
        onToggle: (ruleId, enabled) => this.toggleRule(ruleId, enabled),
        onRenameGroup: (group, next) => this.renameGroupTo(group, next),
        onDeleteGroup: (group) => this.deleteGroup(group),
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

  /**
   * いま表示すべきルール。グループで絞っているときはそのグループだけ。
   * カレンダー・一覧・書き出しのどこでも同じ集合を使う。片方だけ絞られていると、
   * 画面に出ていない予定が書き出しに混ざる。
   */
  private visibleRules(): Rule[] {
    return filterByGroups(this.state.rules, this.activeGroups());
  }

  /** 選択中のグループ。名前を変えた・最後の1件を消したときは「すべて」へ戻す。 */
  private activeGroups(): string[] | null {
    return resolveActiveGroups(this.state.rules, this.state.prefs.activeGroups);
  }

  private setActiveGroups(groups: string[] | null): void {
    this.state.prefs.activeGroups = groups === null || groups.length === 0 ? null : groups;
    this.persist();
    this.render();
  }

  /** 1つのグループの選択を入り切りする。 */
  private toggleActiveGroup(group: string): void {
    const current = this.activeGroups();
    // 「すべて」から1つ押したら、そのグループだけに絞る。
    // 全部が選ばれた状態から1つ外す動きにすると、押した意図と逆になる。
    if (current === null) {
      this.setActiveGroups([group]);
      return;
    }
    const next = current.includes(group)
      ? current.filter((item) => item !== group)
      : [...current, group];
    this.setActiveGroups(next);
  }

  /**
   * グループ名をまとめて付け替える。
   *
   * グループは実体ではなくルールが持つ文字列なので、1件ずつ編集させると
   * 取りこぼす。空にすると未分類へ移す。
   */
  private renameGroupTo(from: string, to: string): void {
    const target = to.trim();
    if (target === from) return;
    const result = renameGroup(this.state.rules, from, target);
    if (!result.ok) {
      // 保存してから気づくと、その束のルールが再読込で消える。手前で止める。
      this.notify(result.reason, 'error');
      this.render();
      return;
    }
    this.state.rules = result.rules;
    // 選んでいた名前は消えるので、新しい名前へ付け替える。
    const current = this.state.prefs.activeGroups;
    if (current !== null && current.includes(from)) {
      this.state.prefs.activeGroups = [...new Set(current.map((g) => (g === from ? target : g)))];
    }
    this.persist();
    this.notify(
      target === UNGROUPED
        ? `「${groupLabel(from)}」のグループ分けを外しました。`
        : `「${groupLabel(from)}」を「${target}」に変えました。`,
    );
    this.render();
  }

  /** グループごとまとめて消す。元に戻せないので、件数を見せてから確かめる。 */
  private deleteGroup(group: string): void {
    const targets = rulesInGroup(this.state.rules, group);
    if (targets.length === 0) return;
    const message =
      `「${groupLabel(group)}」の ${targets.length} 件のルールをすべて削除します。\n` +
      '元に戻せません。よろしいですか？';
    if (!globalThis.confirm(message)) return;
    const ids = new Set(targets.map((rule) => rule.id));
    this.state.rules = this.state.rules.filter((rule) => !ids.has(rule.id));
    this.persist();
    this.notify(`「${groupLabel(group)}」の ${targets.length} 件を削除しました。`);
    this.render();
  }

  private setChipDisplay(mode: 'text' | 'dot'): void {
    this.state.prefs.chipDisplay = mode;
    this.persist();
    this.render();
  }

  /**
   * カレンダー・一覧の上に置く絞り込みと表示の切り替え。
   *
   * ヘッダーではなくここに置くのは、どちらも「いま見ているものの見え方」を
   * 決める操作で、対象のすぐ上にあるほうが結び付きが分かるため。
   */
  private renderViewToolbar(): HTMLElement | null {
    const groups = collectGroups(this.state.rules);
    const isCalendar = this.state.prefs.defaultView !== 'list';
    if (groups.length === 0 && !isCalendar) return null;

    const left = h('div', { class: 'toolbar-left' });
    if (groups.length > 0) {
      // 1つずつしか選べないと、「税務と入金だけ見比べたい」のたびに選び直す
      // ことになる。押して入り切りできる形にして、複数選べるようにする。
      const current = this.activeGroups();
      const choices = h('div', {
        class: 'group-choices',
        role: 'group',
        'aria-label': '表示するグループ',
      });
      const chip = (label: string, pressed: boolean, onClick: () => void): HTMLElement => {
        const node = h(
          'button',
          { type: 'button', class: 'group-chip', 'aria-pressed': pressed ? 'true' : 'false' },
          label,
        );
        node.addEventListener('click', onClick);
        return node;
      };
      choices.append(chip('すべて', current === null, () => this.setActiveGroups(null)));
      const names = [...groups, ...(hasUngrouped(this.state.rules) ? [UNGROUPED] : [])];
      for (const name of names) {
        choices.append(
          chip(groupLabel(name), current !== null && current.includes(name), () =>
            this.toggleActiveGroup(name),
          ),
        );
      }
      // 丸いボタンが並ぶだけでは、複数選べることが初見で伝わらない。
      left.append(field('グループ（複数選択可）', choices));
    }

    const right = h('div', { class: 'toolbar-right' });
    if (isCalendar) {
      const toggle = h('div', {
        class: 'segmented',
        role: 'group',
        'aria-label': 'カレンダーの予定の出し方',
      });
      for (const [value, label, title] of [
        ['text', '内容', '予定名まで出す'],
        ['dot', '点', '点だけにして1か月を見渡す'],
      ] as const) {
        const item = h(
          'button',
          {
            type: 'button',
            class: 'segment',
            title,
            'aria-pressed': this.state.prefs.chipDisplay === value ? 'true' : 'false',
          },
          label,
        );
        item.addEventListener('click', () => this.setChipDisplay(value));
        toggle.append(item);
      }
      right.append(h('span', { class: 'toolbar-label' }, '表示'), toggle);
    }

    // 何で絞ったかは紙にも残す。絞り込んだ結果だけを渡されると誤解を招くため、
    // 画面では隠し、印刷のときだけ見出しとして出す。
    const printedLabel = groupsLabel(this.activeGroups());
    const printed = h(
      'p',
      { class: 'print-group' },
      printedLabel === null ? '' : `グループ: ${printedLabel}`,
    );

    return h('div', { class: 'view-toolbar' }, left, right, printed);
  }

  private buildOccurrences(): {
    occurrencesByDate: Map<DateStr, ReturnType<typeof expandRules>['occurrences']>;
    warnings: ReturnType<typeof expandRules>['warnings'];
    hasNotice: boolean;
  } {
    const ctx = this.scheduleContext(this.businessCalendars());
    const range = gridRangeOf(this.view.year, this.view.month);
    const { occurrences, warnings } = expandRules(this.visibleRules(), range, ctx);
    return {
      occurrencesByDate: groupByDate(occurrences),
      warnings,
      hasNotice: occurrences.some((occurrence) => occurrence.kind !== 'main'),
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
    const hasNotice = all.some((occurrence) => occurrence.kind !== 'main');
    const hasShift = all.some((occurrence) => occurrence.shifted);
    const selectedDate = this.mode.kind === 'day' ? this.mode.date : null;

    const businessDays = baseCalendar.businessDaysOfMonth(this.view.year, this.view.month).length;
    const totalDays = lastDayOfMonth(this.view.year, this.view.month);

    const pane = h(
      'section',
      { class: 'calendar-pane', 'aria-label': '月カレンダー' },
      h('p', { class: 'print-title' }, `${this.view.year}年${this.view.month}月`),
      // 営業日数と決算月を、押せば設定へ行ける形で常に出す。
      // 決算月は設定の中にしか出ておらず、そこから逆算できること自体に
      // 気づかれなかった。何が効いているかを見せる場所が、そのまま入口になる。
      this.renderCalendarSummary(baseCalendar.name, businessDays, totalDays - businessDays),
      renderCalendar(
        grid,
        rulesById,
        {
          onSelectDay: (date) => this.selectDay(date),
          onFocusDate: (date) => this.focusDate(date),
        },
        selectedDate,
      ),
      renderLegend(hasNotice, hasShift),
    );

    // 左へ払うと次の月、右へ払うと前の月。紙をめくる向きに合わせる。
    attachHorizontalSwipe(pane, {
      onSwipeLeft: () => this.goToMonth(1),
      onSwipeRight: () => this.goToMonth(-1),
    });
    return pane;
  }

  /**
   * カレンダーの上に出す一行。いま何が効いているか（営業日数・決算月）を示し、
   * そのまま設定への入口にする。
   */
  private renderCalendarSummary(
    calendarName: string,
    businessDays: number,
    closedDays: number,
  ): HTMLElement {
    const fiscalMonth = this.state.calendars.find((item) => item.id === COMPANY_CALENDAR_ID)
      ?.fiscalYearEndMonth ?? 3;

    const open = button(
      `${calendarName}: 営業日 ${businessDays}日 / 休業日 ${closedDays}日 ・ 決算月 ${fiscalMonth}月`,
      () => this.openMode('settings'),
      'month-summary is-link',
    );
    open.setAttribute('title', '営業日・決算月の設定を開く');
    return open;
  }

  /**
   * ルールが1件も無いときの導線。カレンダーだけでは何もできないため。
   *
   * 主にするのは「最初のルールを作る」。サンプル一式を先に勧めると、
   * 自分の業務と関係のない予定がいきなり並び、どれが自分のものか分からなくなる。
   * まず1件を自分で作ったほうが、何を設定しているのかが分かる。
   * サンプルは「完成例を見る」として隣に置く。目的が違うので並びも分ける。
   */
  private renderEmptyPrompt(): HTMLElement {
    return h(
      'div',
      { class: 'empty-prompt' },
      // 最初の画面で長く説明しても読まれない。何ができるかを1文で言い、
      // あとはボタンの名前で分かるようにする。
      h('p', { class: 'empty-prompt-lead' }, '営業日を考慮した繰り返し予定を作れます。'),
      h(
        'div',
        { class: 'empty-prompt-actions' },
        button('最初のルールを作る', () => this.startAdd(), 'button button-primary'),
        button('完成例を見る', () => void this.openSamples(), 'button'),
        // やりたいことから引ける索引があることを、最初の画面で見せる。
        button('使い方を見る', () => this.openMode('help'), 'button button-quiet'),
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
      this.visibleRules(),
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
    if (Date.now() - Date.parse(this.holidays.meta.fetchedAt) > 14 * 24 * 60 * 60 * 1000) {
      notices.push('祝日データの取得から2週間以上経過しています。通信できる状態で再読み込みし、取得日を確認してください。');
    }
    // 収録範囲の警告は、いま実際に見ている期間に対して出す。
    const shown =
      this.state.prefs.defaultView === 'list'
        ? { start: this.today, end: addDays(this.today, this.state.prefs.listDays - 1) }
        : range;
    const outOfRange = outOfRangeMessage(this.holidays, shown.start, shown.end);
    if (outOfRange !== null) notices.push(outOfRange);
    for (const warning of warnings) notices.push(warning.message);

    const flash = this.flash;
    this.flash = null;

    const skipLink = h('a', { class: 'skip-link', href: '#main' }, '本文へ移動');
    // 断片への移動だけでは焦点が移らないブラウザがあるため、明示的に移す。
    skipLink.addEventListener('click', (event) => {
      event.preventDefault();
      this.root.querySelector<HTMLElement>('#main')?.focus();
    });

    // 通知はまとめて live region に置く。読み上げ中の割り込みを避けて polite にする。
    const banners = h('div', { class: 'banners', role: 'status', 'aria-live': 'polite' });
    if (flash !== null) {
      banners.append(
        h(
          'p',
          { class: `banner${flash.tone === 'error' ? ' banner-error' : ' banner-ok'}` },
          flash.text,
        ),
      );
    }
    for (const message of new Set(notices)) {
      banners.append(h('p', { class: 'banner' }, message));
    }

    // ルールが1件も無いうちは、案内をカレンダーより先に置く。
    // 空のカレンダーの下にあると、何をすればよいかが目に入らない。
    const empty = this.state.rules.length === 0;
    const main = h(
      'main',
      { id: 'main', tabindex: '-1' },
      ...(empty ? [this.renderEmptyPrompt()] : []),
      this.renderViewToolbar(),
      this.state.prefs.defaultView === 'list'
        ? this.buildListPane()
        : this.buildCalendarPane(occurrencesByDate),
    );

    // 予定の出し方は画面全体に効く。画面幅では決めず、選ばれたものに従う。
    this.root.classList.toggle('is-dots', this.state.prefs.chipDisplay === 'dot');

    clear(this.root);
    this.root.append(skipLink, this.renderBrand(), this.renderHeader(), banners, main, this.renderFooter());

    this.syncDialog();
    this.restoreFocus();
  }

  /** 矢印キーで月をまたいだ直後、同じ日にフォーカスを戻す。 */
  private restoreFocus(): void {
    const date = this.pendingFocusDate;
    this.pendingFocusDate = null;
    if (date === null) return;
    this.root.querySelector<HTMLElement>(`.cell-day[data-date="${date}"]`)?.focus();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 起動。祝日データは同梱してあるので、待つものが無く同期で描き切れる。
 */
export function startApp(root: HTMLElement): void {
  new App(root, createBundledHolidayLookup()).render();
}
