/**
 * 学習（docs/SPEC.md §8.13）。ルールを覚えるための復習と、その分析。
 *
 * - 今日の復習: ルール1つが1枚。名前を見て「いつ・休業日なら・前後の予定」を思い出し、
 *   答え（ルールの説明とアプリが計算した日付）を見て4段階で評価する。出す順番はランダム
 * - 週の予定: 先週・今週・来週の予定を思い浮かべる3つの問題。分単位の学習ステップで覚える
 * - これからの復習: 日ごとの復習の数
 * - ルールごとの定着: 覚えている見込み・忘却曲線・これからの予定・過去に実際に来た予定
 *
 * 復習の間隔は FSRS-7（ts-fsrs 6）で決める。この画面と ts-fsrs は、学習の画面を
 * 開いたときに初めて読み込む（src/app.ts）。予定だけ使う人の読み込みを重くしない。
 */

import { buildImportPreview } from '../core/aiImport';
import type { ImportPreviewItem } from '../core/aiImport';
import { weekdayOf } from '../core/dateUtil';
import { occurrenceTitle } from '../core/describe';
import type { ScheduleContext } from '../core/schedule';
import {
  buildQueue,
  createScheduler,
  createShortTermScheduler,
  describeDue,
  describeDueAt,
  DESIRED_RETENTION_CHOICES,
  forecast,
  forgettingCurve,
  loadStudyState,
  NEW_PER_DAY_CHOICES,
  pastOccurrences,
  previewNext,
  previewNextWeek,
  progressOf,
  pruneStudyState,
  recentLogs,
  reviewRule,
  reviewWeek,
  saveStudyState,
  shuffle,
  STUDY_RATINGS,
  summarize,
  WEEK_KEYS,
  weekCardId,
  weekOccurrences,
  weekProgressOf,
  weekQueue,
  weekRange,
} from '../core/study';
import type {
  RuleProgress,
  Scheduler,
  StoredCard,
  StudyRating,
  StudyState,
  StudyStatus,
  WeekKey,
  WeekProgress,
} from '../core/study';
import type { BusinessCalendar, DateStr, Rule } from '../types';
import { button, checkbox, field, select } from './controls';
import { clear, h, scrollIntoView } from './dom';
import { renderPreviewList } from './previewList';
import type { KeyValueStore } from '../core/storage';

export type StudyInput = {
  rules: readonly Rule[];
  calendars: readonly BusinessCalendar[];
  ctx: ScheduleContext;
  today: DateStr;
};

export type StudyDeps = {
  store: KeyValueStore;
  /** 今の時刻。テストで固定するために受け取る。 */
  now: () => Date;
  notify: (text: string, tone?: 'info' | 'error') => void;
  /** 0〜1 の乱数。出題の順番に使う。テストで固定するために受け取る。 */
  random?: () => number;
};


/** カードの id が週の予定の問題なら、その週。 */
const weekKeyOf = (id: string): WeekKey | null => WEEK_KEYS.find((key) => weekCardId(key) === id) ?? null;

/** 同じ復習の中で、分単位の間隔ならもう一度出す（この時間より先なら、今回は出さない）。 */
const KEEP_IN_SESSION_MS = 60 * 60_000;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

const withWeekday = (date: DateStr): string => `${date}（${WEEKDAYS[weekdayOf(date)] ?? ''}）`;
const percent = (value: number): string => `${Math.round(value * 100)}%`;
const WEEK_LABELS: Record<WeekKey, string> = { last: '先週の予定', this: '今週の予定', next: '来週の予定' };
const shortDate = (date: DateStr): string =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}（${WEEKDAYS[weekdayOf(date)] ?? ''}）`;

const STATUS_LABELS: Record<StudyStatus, string> = {
  new: 'まだ覚えていない',
  learning: '覚えはじめ',
  review: '復習中',
  relearning: '覚え直し中',
  paused: '一時停止中',
};

const RATING_LABELS: Record<StudyRating, string> = Object.fromEntries(
  STUDY_RATINGS.map((item) => [item.rating, item.label]),
) as Record<StudyRating, string>;

type Session = {
  /** すぐ出せるカードの id（先頭が今のカード）。ルールの id か週の予定の問題の id。 */
  queue: string[];
  /** 分単位の間隔で、時間が来たら出すカード。 */
  pending: { id: string; dueAt: number }[];
  revealed: boolean;
  /** このセッションで評価した数。 */
  done: number;
};

const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

export class StudyView {
  readonly element = h('section', { class: 'study', 'aria-labelledby': 'study-heading' });
  private input: StudyInput;
  private state: StudyState;
  private session: Session | null = null;
  /** 待っているカードの時間が来たら描き直すためのタイマー。 */
  private timer: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    private readonly deps: StudyDeps,
    input: StudyInput,
    private scheduler: Scheduler,
    /** 週の予定の問題用（分単位の学習ステップ）。 */
    private shortScheduler: Scheduler,
    state: StudyState,
    dropped: number,
  ) {
    this.input = input;
    this.state = pruneStudyState(state, input.rules);
    if (dropped > 0) {
      deps.notify(`学習の記録のうち、読めなかった ${dropped} 件を除きました。`, 'error');
    }
    this.render();
  }

  /** 記録を読み、FSRS-7 の計算を用意してから作る。 */
  static async create(deps: StudyDeps, input: StudyInput): Promise<StudyView> {
    const { state, dropped } = loadStudyState(deps.store);
    const [scheduler, shortScheduler] = await Promise.all([
      createScheduler(state.desiredRetention),
      createShortTermScheduler(state.desiredRetention),
    ]);
    return new StudyView(deps, input, scheduler, shortScheduler, state, dropped);
  }

  /** ルールや日付が変わったら描き直す。復習の途中なら、そのカードを続ける。 */
  update(input: StudyInput): void {
    this.input = input;
    const pruned = pruneStudyState(this.state, input.rules);
    if (pruned !== this.state) {
      this.state = pruned;
      this.persist();
    }
    if (this.session !== null) {
      const ids = new Set(input.rules.filter((rule) => rule.enabled).map((rule) => rule.id));
      const keep = (id: string): boolean => ids.has(id) || weekKeyOf(id) !== null;
      this.session.queue = this.session.queue.filter(keep);
      this.session.pending = this.session.pending.filter((item) => keep(item.id));
    }
    this.render();
  }

  private persist(): void {
    try {
      saveStudyState(this.deps.store, this.state);
    } catch {
      this.deps.notify('学習の記録を保存できませんでした。ブラウザの保存領域を確かめてください。', 'error');
    }
  }

  private progress(): RuleProgress[] {
    return progressOf(this.input.rules, this.state, this.scheduler, this.deps.now(), this.input.today);
  }

  private random(): number {
    return (this.deps.random ?? Math.random)();
  }

  private weekProgress(): WeekProgress[] {
    return weekProgressOf(this.state, this.shortScheduler, this.deps.now(), this.input.today);
  }

  private render(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    clear(this.element);
    if (this.session !== null) {
      this.renderSession(this.session);
      return;
    }
    this.renderOverview();
  }

  // -------------------------------------------------------------------------
  // 一覧（まとめ・これからの復習・ルールごとの定着・設定）
  // -------------------------------------------------------------------------

  private renderOverview(): void {
    const { today, rules } = this.input;
    this.element.append(
      h('h2', { class: 'page-title', id: 'study-heading' }, '学習'),
      h(
        'p',
        { class: 'field-hint' },
        'ルールを覚えるための復習です。ルールの名前を見て「いつ・休業日なら・前後の予定」を思い出し、答えを見て評価します。忘れかけたころに次の復習が来るよう、FSRS-7 で間隔を決めます。',
      ),
    );
    if (rules.length === 0) {
      this.element.append(
        h('p', { class: 'study-empty' }, 'ルールを登録すると、ここで覚えられます。'),
      );
      return;
    }

    const progress = this.progress();
    const summary = summarize(progress, this.state, today);
    const queue = buildQueue(progress, this.state, today);
    const weeks = this.weekProgress();
    const weekIds = this.state.weekCards ? weekQueue(weeks, this.deps.now()).map((item) => item.id) : [];
    const ids = [...queue.map((item) => item.rule.id), ...weekIds];

    const tile = (label: string, value: string, note?: string) =>
      h(
        'div',
        { class: 'study-stat' },
        h('p', { class: 'study-stat-label' }, label),
        h('p', { class: 'study-stat-value' }, value),
        note === undefined ? null : h('p', { class: 'study-stat-note' }, note),
      );
    this.element.append(
      h(
        'div',
        { class: 'study-stats' },
        tile('今日の復習', `${summary.due} 件`, weekIds.length === 0 ? undefined : `ほかに週の予定 ${weekIds.length} 問`),
        tile('新しく覚える', `${summary.newToday} 件`, this.state.newPerDay === 0 ? '上限なし' : `1日 ${this.state.newPerDay} 件まで`),
        tile('覚えたルール', `${summary.learned} / ${summary.total}`),
        tile(
          '平均の定着率',
          summary.averageRetention === null ? '—' : percent(summary.averageRetention),
          `目標 ${percent(this.state.desiredRetention)}`,
        ),
      ),
    );

    const start = button(
      ids.length === 0 ? '今日の復習は終わりました' : `復習を始める（${ids.length} 件）`,
      () => this.startSession(ids),
      'button button-primary study-start',
    );
    start.disabled = ids.length === 0;
    this.element.append(
      h('div', { class: 'study-actions' }, start),
      h('p', { class: 'field-hint' }, '問題はランダムな順番で出ます。'),
    );

    if (this.state.weekCards) this.element.append(this.renderWeeks(weeks));
    this.element.append(this.renderForecast(progress));
    this.element.append(this.renderRuleList(progress));
    this.element.append(this.renderSettings());
  }

  /** これからの復習の数（14日）。棒グラフと、同じ数字の一覧。 */
  private renderForecast(progress: readonly RuleProgress[]): HTMLElement {
    const days = forecast(progress, this.input.today, 14);
    const max = Math.max(1, ...days.map((day) => day.count));
    const width = 336;
    const height = 120;
    const top = 16;
    const bottom = 22;
    const slot = width / days.length;
    const barWidth = Math.max(4, slot - 2);
    const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'study-chart study-forecast-chart', role: 'img' });
    const total = days.reduce((sum, day) => sum + day.count, 0);
    chart.setAttribute('aria-label', `今日から14日間の復習: 合計 ${total} 件。いちばん多い日は ${max} 件。`);
    chart.append(svg('line', { x1: 0, x2: width, y1: height - bottom, y2: height - bottom, class: 'chart-axis' }));
    days.forEach((day, index) => {
      const x = index * slot + (slot - barWidth) / 2;
      const barHeight = day.count === 0 ? 0 : Math.max(3, ((height - top - bottom) * day.count) / max);
      const y = height - bottom - barHeight;
      if (barHeight > 0) {
        // 上端だけを丸める（基準線側は角のまま）。
        const r = Math.min(4, barWidth / 2, barHeight);
        const bar = svg('path', {
          d: `M${x},${y + barHeight}V${y + r}Q${x},${y} ${x + r},${y}H${x + barWidth - r}Q${x + barWidth},${y} ${x + barWidth},${y + r}V${y + barHeight}Z`,
          class: 'chart-bar',
        });
        const tip = svg('title');
        tip.textContent = `${withWeekday(day.date)}: ${day.count} 件`;
        bar.append(tip);
        chart.append(bar);
        const label = svg('text', { x: x + barWidth / 2, y: y - 4, class: 'chart-value', 'text-anchor': 'middle' });
        label.textContent = String(day.count);
        chart.append(label);
      }
      if (index === 0 || index === 7 || index === days.length - 1) {
        const tick = svg('text', { x: x + barWidth / 2, y: height - 6, class: 'chart-tick', 'text-anchor': 'middle' });
        tick.textContent = index === 0 ? '今日' : day.date.slice(5).replace('-', '/');
        chart.append(tick);
      }
    });

    const list = h('ul', { class: 'study-forecast-list' });
    for (const day of days.filter((item) => item.count > 0)) {
      list.append(h('li', {}, `${withWeekday(day.date)}: ${day.count} 件`));
    }
    if (list.childElementCount === 0) list.append(h('li', {}, 'この14日間に復習の予定はありません。'));

    // まだ何も覚えていなければ、空のグラフは出さない。
    if (total === 0) {
      return h(
        'section',
        { class: 'study-section' },
        h('h3', { class: 'study-section-title' }, 'これからの復習'),
        h('p', { class: 'field-hint' }, 'この14日間に復習の予定はありません。ルールを覚えると、ここに日ごとの復習の数が出ます。'),
      );
    }
    return h(
      'section',
      { class: 'study-section' },
      h('h3', { class: 'study-section-title' }, 'これからの復習'),
      chart,
      h('details', { class: 'advanced-options' }, h('summary', {}, '日ごとの数を一覧で見る'), list),
    );
  }

  /** ルールごとの定着。覚えている見込みの低い順。開くと詳しく見られる。 */
  private renderRuleList(progress: readonly RuleProgress[]): HTMLElement {
    const order = (item: RuleProgress): number =>
      item.status === 'paused' ? 3 : item.retrievability === null ? 2 : item.retrievability;
    const sorted = [...progress].sort((a, b) => order(a) - order(b));
    const list = h('ul', { class: 'study-rules' });
    for (const item of sorted) list.append(this.renderRuleItem(item));
    return h(
      'section',
      { class: 'study-section' },
      h('h3', { class: 'study-section-title' }, 'ルールごとの定着'),
      h('p', { class: 'field-hint' }, '覚えている見込みの低い順です。開くと、忘却曲線・これからの予定・過去に実際に来た予定を見られます。'),
      list,
    );
  }

  private renderRuleItem(item: RuleProgress): HTMLElement {
    const { rule } = item;
    const meter =
      item.retrievability === null
        ? null
        : h(
            'span',
            { class: 'study-meter', 'aria-hidden': 'true' },
            h('span', { class: 'study-meter-fill', style: `width: ${Math.round(item.retrievability * 100)}%` }),
          );
    const value =
      item.retrievability === null ? STATUS_LABELS[item.status] : `定着 ${percent(item.retrievability)}`;
    const next =
      item.dueDate === null ? '' : `次の復習: ${describeDue(this.input.today, item.dueDate)}`;
    const summary = h(
      'summary',
      { class: 'study-rule-summary' },
      h(
        'span',
        { class: 'study-rule-name' },
        h('span', { class: `rule-dot color-${rule.color}`, 'aria-hidden': 'true' }),
        rule.title,
      ),
      h('span', { class: 'study-rule-meta' }, meter, h('span', { class: 'study-rule-value' }, value), next === '' ? null : h('span', { class: 'study-rule-next' }, next)),
    );
    const body = h('div', { class: 'study-rule-body' });
    const details = h('details', { class: 'study-rule' }, summary, body);
    // 中身は開いたときに作る。ルールが多いと、全部の曲線と過去の日付を先に計算すると重い。
    details.addEventListener('toggle', () => {
      if (details.open && body.childElementCount === 0) body.append(...this.renderRuleDetail(item));
    });
    return h('li', {}, details);
  }

  private renderRuleDetail(item: RuleProgress): HTMLElement[] {
    const { rule, card } = item;
    const parts: HTMLElement[] = [];
    if (item.changed) {
      parts.push(h('p', { class: 'issue issue-warning' }, '前回の復習のあとで、このルールの中身が変わりました。答えを見直しておきましょう。'));
    }
    if (card !== null && card.lastReviewAt !== null) {
      const facts = h('dl', { class: 'study-facts' });
      const fact = (label: string, value: string) => facts.append(h('dt', {}, label), h('dd', {}, value));
      if (item.retrievability !== null) fact('覚えている見込み', percent(item.retrievability));
      if (item.dueDate !== null) fact('次の復習', `${withWeekday(item.dueDate)}（${describeDue(this.input.today, item.dueDate)}）`);
      fact('安定性', `${card.stability < 1 ? '1日未満' : `${Math.round(card.stability)}日`}（覚えている見込みが90%まで下がる目安）`);
      fact('難しさ', `${Math.round(card.difficulty * 10) / 10}（1〜10。大きいほど覚えにくい）`);
      fact('復習した回数', `${card.reps} 回（忘れた回数 ${card.lapses} 回）`);
      parts.push(facts, this.renderCurve(card, item.retrievability));
    } else if (item.status !== 'paused') {
      parts.push(h('p', { class: 'field-hint' }, 'まだ覚えていません。復習で一度評価すると、忘却曲線が出ます。'));
    }

    const preview = this.previewOf(rule);
    parts.push(
      h('h4', { class: 'study-detail-title' }, 'ルール'),
      h('p', { class: 'study-answer-desc' }, preview.summary),
    );
    if (preview.notices.length > 0) {
      parts.push(h('ul', { class: 'study-notices' }, ...preview.notices.map((notice) => h('li', {}, notice))));
    }
    parts.push(h('h4', { class: 'study-detail-title' }, 'これからの予定'));
    parts.push(preview.series.length === 0 ? h('p', { class: 'field-hint' }, '予定はありません。') : renderPreviewList(preview.series));

    parts.push(h('h4', { class: 'study-detail-title' }, '過去に実際に来た予定'));
    parts.push(this.renderPast(rule));

    const logs = recentLogs(this.state, rule.id);
    if (logs.length > 0) {
      parts.push(
        h('h4', { class: 'study-detail-title' }, '最近の評価'),
        h(
          'ul',
          { class: 'study-logs' },
          ...logs.map((log) =>
            h(
              'li',
              {},
              `${log.at.slice(0, 10)} ${RATING_LABELS[log.rating]}${log.retrievability === null ? '（初めて）' : `（そのときの見込み ${percent(log.retrievability)}）`}`,
            ),
          ),
        ),
      );
    }
    if (rule.enabled) {
      parts.push(
        h('div', { class: 'study-actions' }, button('このルールを今すぐ復習', () => this.startSession([rule.id]), 'button')),
      );
    }
    return parts;
  }

  /** 過去に実際に来た予定（本体）。休業日で動いた回は理由を添える。 */
  private renderPast(rule: Rule): HTMLElement {
    const past = pastOccurrences(rule, this.input.ctx, this.input.today, 6, 6);
    if (past.length === 0) return h('p', { class: 'field-hint' }, 'この半年に来た予定はありません。');
    return h(
      'ul',
      { class: 'study-past' },
      ...past.map((occurrence) =>
        h(
          'li',
          {},
          withWeekday(occurrence.date),
          occurrence.shifted
            ? h(
                'span',
                { class: 'study-past-note' },
                ` ← 本来は ${withWeekday(occurrence.rawDate)}。休業日のため${occurrence.shiftDirection === 'prev' ? '前' : '後ろ'}へ`,
              )
            : null,
        ),
      ),
    );
  }

  /**
   * 忘却曲線。前回の復習から、覚えている見込みがどう下がるか。
   * 目標の定着率の線と「今日」の点を重ね、数字の一覧も付ける（色や形だけに頼らない）。
   */
  private renderCurve(card: StoredCard, now: number | null): HTMLElement {
    const elapsed = Math.max(0, (this.deps.now().getTime() - Date.parse(card.lastReviewAt ?? '')) / 86_400_000);
    const span = Math.min(365, Math.max(30, Math.ceil(Math.max(card.scheduledDays * 2, elapsed * 1.5))));
    const step = span <= 60 ? 1 : Math.ceil(span / 60);
    const points = forgettingCurve(this.scheduler, card, span, step);
    const width = 336;
    const height = 160;
    const left = 30;
    const right = 8;
    const top = 10;
    const bottom = 22;
    const x = (day: number) => left + ((width - left - right) * day) / span;
    const y = (value: number) => top + (height - top - bottom) * (1 - value);

    const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'study-chart study-curve', role: 'img' });
    for (const value of [0, 0.5, 1]) {
      chart.append(svg('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), class: 'chart-grid' }));
      const label = svg('text', { x: left - 4, y: y(value) + 4, class: 'chart-tick', 'text-anchor': 'end' });
      label.textContent = `${value * 100}%`;
      chart.append(label);
    }
    const target = this.state.desiredRetention;
    chart.append(svg('line', { x1: left, x2: width - right, y1: y(target), y2: y(target), class: 'chart-target' }));
    const targetLabel = svg('text', { x: width - right, y: y(target) - 4, class: 'chart-tick', 'text-anchor': 'end' });
    targetLabel.textContent = `目標 ${percent(target)}`;
    chart.append(targetLabel);
    if (card.scheduledDays > 0 && card.scheduledDays <= span) {
      chart.append(svg('line', { x1: x(card.scheduledDays), x2: x(card.scheduledDays), y1: top, y2: height - bottom, class: 'chart-marker' }));
    }
    chart.append(
      svg('path', {
        d: points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.day).toFixed(1)},${y(point.retrievability).toFixed(1)}`).join(''),
        class: 'chart-line',
      }),
    );
    for (const [day, label] of [[0, '前回'], [span, `${span}日後`]] as const) {
      const tick = svg('text', { x: x(day), y: height - 6, class: 'chart-tick', 'text-anchor': day === 0 ? 'start' : 'end' });
      tick.textContent = label;
      chart.append(tick);
    }
    if (now !== null && elapsed <= span) {
      chart.append(svg('circle', { cx: x(elapsed), cy: y(now), r: 4.5, class: 'chart-today' }));
    }

    // ふれた位置の日と見込みを出す。
    const tooltip = h('p', { class: 'chart-tooltip', 'aria-hidden': 'true' });
    tooltip.hidden = true;
    const guide = svg('line', { y1: top, y2: height - bottom, class: 'chart-guide' });
    guide.style.display = 'none';
    chart.append(guide);
    chart.addEventListener('pointermove', (event) => {
      const box = chart.getBoundingClientRect();
      if (box.width === 0) return;
      const day = Math.round((((event.clientX - box.left) / box.width) * width - left) / ((width - left - right) / span));
      const nearest = points.reduce((best, point) => (Math.abs(point.day - day) < Math.abs(best.day - day) ? point : best), points[0]!);
      guide.setAttribute('x1', String(x(nearest.day)));
      guide.setAttribute('x2', String(x(nearest.day)));
      guide.style.display = '';
      tooltip.hidden = false;
      tooltip.textContent = `前回から${nearest.day}日: ${percent(nearest.retrievability)}`;
    });
    chart.addEventListener('pointerleave', () => {
      guide.style.display = 'none';
      tooltip.hidden = true;
    });

    const nextDay = Math.round(card.scheduledDays);
    const nextText = card.scheduledDays < 1 ? '次の復習はその日のうち' : `次の復習は前回から約${nextDay}日後`;
    const caption = `前回の復習から${Math.floor(elapsed)}日${now === null ? '' : `で ${percent(now)}`}。${nextText}で、そのころの見込みは目標の ${percent(target)} 前後です。`;
    chart.setAttribute('aria-label', `忘却曲線。${caption}`);

    const table = h('table', { class: 'study-curve-table' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '前回から'), h('th', { scope: 'col' }, '覚えている見込み'))));
    const tbody = h('tbody');
    const marks = [...new Set([0, 1, 3, 7, 14, 30, 60, 90, 180, 365].filter((day) => day <= span).concat(nextDay <= span ? [nextDay] : []))].sort((a, b) => a - b);
    for (const day of marks) {
      const value = forgettingCurve(this.scheduler, card, day, Math.max(1, day))[1]?.retrievability ?? 1;
      tbody.append(h('tr', {}, h('td', {}, `${day}日`), h('td', {}, percent(day === 0 ? 1 : value))));
    }
    table.append(tbody);

    return h(
      'figure',
      { class: 'study-figure' },
      h('div', { class: 'study-chart-wrap' }, chart, tooltip),
      h('figcaption', { class: 'field-hint' }, caption),
      h('details', { class: 'advanced-options' }, h('summary', {}, '数値で見る'), table),
    );
  }

  private renderSettings(): HTMLElement {
    const retention = select(
      DESIRED_RETENTION_CHOICES.map((value) => ({ value: String(value), label: percent(value) })),
      String(this.state.desiredRetention),
      (value) => void this.setRetention(Number(value)),
    );
    const perDay = select(
      NEW_PER_DAY_CHOICES.map((value) => ({ value: String(value), label: value === 0 ? '上限なし' : `${value} 件` })),
      String(this.state.newPerDay),
      (value) => {
        this.state = { ...this.state, newPerDay: Number(value) };
        this.persist();
        this.render();
      },
    );
    return h(
      'section',
      { class: 'study-section' },
      h(
        'details',
        { class: 'advanced-options study-settings' },
        h('summary', {}, '学習の設定'),
        field('目標の定着率', retention, '高くすると忘れにくくなりますが、復習が増えます。'),
        field('1日に新しく覚えるルール', perDay),
        checkbox('先週・今週・来週の予定を思い浮かべる問題を出す', this.state.weekCards, (weekCards) => {
          this.state = { ...this.state, weekCards };
          this.persist();
          this.render();
        }),
        h(
          'div',
          { class: 'study-actions' },
          button('学習の記録を消す', () => this.clearRecords(), 'button button-danger'),
        ),
        h('p', { class: 'field-hint' }, '学習の記録はこの端末のブラウザに保存し、設定の〈エクスポート〉でルールと一緒に書き出せます。'),
      ),
    );
  }

  private async setRetention(value: number): Promise<void> {
    this.state = { ...this.state, desiredRetention: value };
    this.persist();
    // 目標が変わると、次の間隔の決め方が変わる。計算の仕組みを作り直す。
    [this.scheduler, this.shortScheduler] = await Promise.all([createScheduler(value), createShortTermScheduler(value)]);
    this.render();
  }

  private clearRecords(): void {
    if (!globalThis.confirm('学習の記録（覚えた状態と評価の履歴）を消します。ルールは消えません。取り消せません。')) return;
    this.state = { ...this.state, cards: {}, logs: [] };
    this.persist();
    this.deps.notify('学習の記録を消しました。');
    this.render();
  }

  // -------------------------------------------------------------------------
  // 復習
  // -------------------------------------------------------------------------

  private startSession(ids: string[]): void {
    if (ids.length === 0) return;
    this.session = { queue: shuffle(ids, () => this.random()), pending: [], revealed: false, done: 0 };
    this.render();
    this.element.querySelector<HTMLElement>('.study-card-title')?.focus();
    scrollIntoView(this.element);
  }

  private endSession(): void {
    this.session = null;
    this.render();
    this.element.querySelector<HTMLElement>('#study-heading')?.focus();
  }

  private previewOf(rule: Rule): ImportPreviewItem {
    return buildImportPreview([rule], this.input.calendars, this.input.ctx, this.input.today, 3)[0] as ImportPreviewItem;
  }

  /** 時間の来た「待ち」のカードを、ランダムな位置に戻す。 */
  private promoteDue(session: Session): void {
    const now = this.deps.now().getTime();
    const ready = session.pending.filter((item) => item.dueAt <= now);
    if (ready.length === 0) return;
    session.pending = session.pending.filter((item) => item.dueAt > now);
    for (const item of ready) this.insertRandomly(session, item.id);
  }

  /** 今のカード（先頭）の直後より後ろのどこかへ入れる。同じ問題が続けて出ないように。 */
  private insertRandomly(session: Session, id: string): void {
    const from = session.queue.length === 0 ? 0 : 1;
    const at = from + Math.floor(this.random() * (session.queue.length - from + 1));
    session.queue.splice(at, 0, id);
  }

  private renderSession(session: Session): void {
    this.promoteDue(session);
    const id = session.queue[0];
    if (id === undefined) {
      if (session.pending.length > 0) this.renderWaiting(session);
      else this.renderDone(session);
      return;
    }
    const week = weekKeyOf(id);
    if (week !== null) {
      this.renderWeekCard(session, week);
      return;
    }
    const rule = this.input.rules.find((item) => item.id === id);
    if (rule === undefined) {
      session.queue.shift();
      this.renderSession(session);
      return;
    }
    this.renderRuleCard(session, rule);
  }

  private renderDone(session: Session): void {
    const heading = h('h2', { class: 'page-title', id: 'study-heading', tabindex: '-1' }, '今日の復習が終わりました');
    this.element.append(
      heading,
      h('p', { class: 'study-done' }, `${session.done} 件を復習しました。次の復習の予定は、学習の画面で見られます。`),
      h('div', { class: 'study-actions' }, button('学習の画面へ戻る', () => this.endSession(), 'button button-primary')),
    );
    heading.focus();
  }

  /**
   * 分単位の間隔の問題を待っているところ。時間が来たら自動で出す。
   * 待たずに続けたいときのために〈今すぐ出す〉も置く。
   */
  private renderWaiting(session: Session): void {
    const next = [...session.pending].sort((a, b) => a.dueAt - b.dueAt)[0]!;
    const now = this.deps.now().getTime();
    const minutes = Math.max(1, Math.ceil((next.dueAt - now) / 60_000));
    const week = weekKeyOf(next.id);
    const name = week === null ? (this.input.rules.find((rule) => rule.id === next.id)?.title ?? '') : WEEK_LABELS[week];
    const heading = h('h2', { class: 'page-title', id: 'study-heading', tabindex: '-1' }, '少し時間をおいて、もう一度');
    this.element.append(
      heading,
      h(
        'p',
        { class: 'study-waiting' },
        `次は「${name}」です。あと約${minutes}分で出します。少し時間をおいてから思い出すと、頭に残りやすくなります。`,
      ),
      h(
        'div',
        { class: 'study-actions' },
        button('今すぐ出す', () => {
          session.pending = session.pending.filter((item) => item !== next);
          session.queue.push(next.id);
          this.render();
          this.element.querySelector<HTMLElement>('.study-card-title')?.focus();
        }, 'button button-primary'),
        button('終わる', () => this.endSession(), 'button button-quiet'),
      ),
    );
    heading.focus();
    // 時間が来たら描き直す（この画面を開いたままにしている人のため）。
    this.timer = setTimeout(() => {
      if (this.session === session) this.render();
    }, Math.max(0, next.dueAt - now) + 500);
  }

  private ratingButtons(labels: Record<StudyRating, string>, onRate: (rating: StudyRating) => void): HTMLElement {
    const ratings = h('div', { class: 'study-ratings', role: 'group', 'aria-label': '思い出せたか' });
    for (const { rating, label } of STUDY_RATINGS) {
      const choice = button('', () => onRate(rating), `button study-rating study-rating-${rating}`);
      // 名前は見えている文字のまま（「できた 次は10分後」）。別の名前を付けると、
      // 音声操作で見えている言葉を言っても押せなくなる（axe の label-content-name-mismatch）。
      choice.append(h('span', { class: 'study-rating-label' }, label), h('span', { class: 'study-rating-next' }, `次は${labels[rating]}`));
      ratings.append(choice);
    }
    return ratings;
  }

  /** 表のカード。答えを見るまでのところは、ルールでも週の予定でも同じ形。 */
  private cardFrame(session: Session, title: (Node | string)[], extra: (HTMLElement | null)[], question: string): HTMLElement {
    return h(
      'article',
      { class: 'study-card', 'aria-live': 'polite' },
      h('p', { class: 'study-card-count' }, `残り ${session.queue.length + session.pending.length} 件`),
      h('h2', { class: 'study-card-title', id: 'study-heading', tabindex: '-1' }, ...title),
      ...extra,
      h('p', { class: 'study-card-question' }, question),
    );
  }

  private revealButton(session: Session, finish: HTMLElement): HTMLElement {
    return h(
      'div',
      { class: 'study-actions' },
      button('答えを見る', () => {
        session.revealed = true;
        this.render();
        this.element.querySelector<HTMLElement>('.study-answer')?.focus();
      }, 'button button-primary'),
      finish,
    );
  }

  private renderRuleCard(session: Session, rule: Rule): void {
    const finish = button('終わる', () => this.endSession(), 'button button-quiet');
    const progress = progressOf([rule], this.state, this.scheduler, this.deps.now(), this.input.today)[0];
    const card = this.cardFrame(
      session,
      [h('span', { class: `rule-dot color-${rule.color}`, 'aria-hidden': 'true' }), rule.title],
      [
        rule.group === undefined || rule.group === '' ? null : h('p', { class: 'rule-group-tag' }, rule.group),
        progress?.changed === true
          ? h('p', { class: 'issue issue-warning' }, '前回の復習のあとで、このルールの中身が変わりました。')
          : null,
      ],
      'いつ来る予定ですか？ 休業日にあたったら？ 前後にする作業は？',
    );

    if (!session.revealed) {
      card.append(this.revealButton(session, finish));
      this.element.append(card);
      return;
    }

    const preview = this.previewOf(rule);
    const answer = h(
      'div',
      { class: 'study-answer', tabindex: '-1' },
      h('p', { class: 'study-answer-desc' }, preview.summary),
      h('p', { class: 'study-answer-meta' }, `${preview.calendarName}で数える`),
    );
    if (preview.notices.length > 0) {
      answer.append(h('ul', { class: 'study-notices' }, ...preview.notices.map((notice) => h('li', {}, notice))));
    }
    if (preview.series.length > 0) {
      answer.append(h('p', { class: 'ai-preview-label' }, `次の${preview.series.length}回`), renderPreviewList(preview.series));
    }
    const past = pastOccurrences(rule, this.input.ctx, this.input.today, 3, 1)[0];
    if (past !== undefined) {
      answer.append(
        h(
          'p',
          { class: 'study-answer-meta' },
          `前回は ${withWeekday(past.date)}${past.shifted ? `（本来は ${withWeekday(past.rawDate)}。休業日のため${past.shiftDirection === 'prev' ? '前' : '後ろ'}へ）` : ''}`,
        ),
      );
    }

    const labels = previewNext(this.scheduler, this.state, rule, this.deps.now(), this.input.today);
    card.append(
      answer,
      h('p', { class: 'field-hint' }, '思い出せた度合いを選んでください。'),
      this.ratingButtons(labels, (rating) => this.rateRule(rule, rating)),
      h('div', { class: 'study-actions' }, finish),
    );
    this.element.append(card);
  }

  /** 週の予定の問題。答えは、その週の予定（本体と前後の予定）をアプリが計算したもの。 */
  private renderWeekCard(session: Session, key: WeekKey): void {
    const finish = button('終わる', () => this.endSession(), 'button button-quiet');
    const range = weekRange(key, this.input.today);
    const card = this.cardFrame(
      session,
      [WEEK_LABELS[key]],
      [h('p', { class: 'study-week-range' }, `${shortDate(range.start)} 〜 ${shortDate(range.end)}`)],
      'この週に、何曜日に何がありますか？ 前後の作業（準備・確認）も思い浮かべてください。',
    );
    if (!session.revealed) {
      card.append(this.revealButton(session, finish));
      this.element.append(card);
      return;
    }

    const enabled = this.input.rules.filter((rule) => rule.enabled);
    const days = weekOccurrences(enabled, this.input.ctx, range);
    const answer = h('div', { class: 'study-answer', tabindex: '-1' });
    if (days.length === 0) {
      answer.append(h('p', {}, 'この週に予定はありません。'));
    } else {
      const list = h('dl', { class: 'study-week' });
      for (const day of days) {
        list.append(
          h('dt', { class: day.date === this.input.today ? 'is-today' : '' }, shortDate(day.date)),
          h(
            'dd',
            {},
            h('ul', {}, ...day.items.map(({ occurrence, rule }) =>
              h(
                'li',
                { class: occurrence.kind === 'main' ? '' : 'is-notice' },
                h('span', { class: `rule-dot color-${rule.color}`, 'aria-hidden': 'true' }),
                occurrenceTitle(occurrence, rule),
                occurrence.kind === 'main' && occurrence.shifted ? h('span', { class: 'study-past-note' }, `（本来は ${shortDate(occurrence.rawDate)}）`) : null,
              ),
            )),
          ),
        );
      }
      answer.append(list);
    }

    const labels = previewNextWeek(this.shortScheduler, this.state, key, this.deps.now(), this.input.today);
    card.append(
      answer,
      h('p', { class: 'field-hint' }, '思い出せた度合いを選んでください。この問題は1分・10分と短い間隔で繰り返します。'),
      this.ratingButtons(labels, (rating) => this.rateWeek(key, rating)),
      h('div', { class: 'study-actions' }, finish),
    );
    this.element.append(card);
  }

  private afterRating(session: Session): void {
    session.revealed = false;
    session.done += 1;
    this.persist();
    this.render();
    this.element.querySelector<HTMLElement>('.study-card-title, #study-heading')?.focus();
  }

  private rateRule(rule: Rule, rating: StudyRating): void {
    const session = this.session;
    if (session === null) return;
    this.state = reviewRule(this.state, this.scheduler, rule, rating, this.deps.now());
    session.queue.shift();
    // 「もう一度」は、このセッションのどこかでもう一度出す。
    if (rating === 1) this.insertRandomly(session, rule.id);
    this.afterRating(session);
  }

  private rateWeek(key: WeekKey, rating: StudyRating): void {
    const session = this.session;
    if (session === null) return;
    const now = this.deps.now();
    this.state = reviewWeek(this.state, this.shortScheduler, key, rating, now, this.input.today);
    session.queue.shift();
    // 分単位の間隔なら、時間が来たらこの復習の中でもう一度出す。
    const dueAt = Date.parse(this.state.cards[weekCardId(key)]?.dueAt ?? '');
    if (dueAt - now.getTime() <= KEEP_IN_SESSION_MS) session.pending.push({ id: weekCardId(key), dueAt });
    this.afterRating(session);
  }

  // -------------------------------------------------------------------------
  // 週の予定（一覧）
  // -------------------------------------------------------------------------

  private renderWeeks(weeks: readonly WeekProgress[]): HTMLElement {
    const now = this.deps.now();
    const list = h('ul', { class: 'study-weeks' });
    for (const item of weeks) {
      const status =
        item.retrievability === null
          ? 'まだ覚えていない'
          : `定着 ${percent(item.retrievability)}${item.dueAt === null ? '' : ` ・ 次: ${describeDueAt(now, item.dueAt, this.input.today)}`}`;
      list.append(
        h(
          'li',
          { class: 'study-week-row' },
          h(
            'span',
            { class: 'study-week-name' },
            WEEK_LABELS[item.key],
            h('span', { class: 'study-week-range' }, `${shortDate(item.start)}〜${shortDate(item.end)}`),
          ),
          h('span', { class: 'study-week-status' }, status),
          button('今すぐ', () => this.startSession([item.id]), 'button button-sm'),
        ),
      );
    }
    return h(
      'section',
      { class: 'study-section' },
      h('h3', { class: 'study-section-title' }, '週の予定'),
      h(
        'p',
        { class: 'field-hint' },
        '先週・今週・来週の予定を思い浮かべる問題です。1分・10分と短い間隔で繰り返して覚えます。週が替わると、新しい週の問題になります。',
      ),
      list,
    );
  }
}
