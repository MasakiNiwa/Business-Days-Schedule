/**
 * @vitest-environment jsdom
 *
 * 描画層の回帰テスト（docs/SPEC.md §8.2）。
 * 見た目そのものではなく「休業日・祝日・補正が正しくマークアップに現れるか」と
 * 「ユーザー入力がエスケープされるか」を固定する。
 */

import { describe, expect, it, vi } from 'vitest';
import { buildMonthGrid } from '../src/core/monthGrid';
import type { MonthGridContext } from '../src/core/monthGrid';
import { expandRules, groupByDate } from '../src/core/schedule';
import type { BusinessCalendar, Rule } from '../src/types';
import { MAX_CHIPS_PER_CELL, renderCalendar, renderLegend } from '../src/ui/CalendarView';
import { renderRuleList } from '../src/ui/RuleList';
import type { RuleListHandlers } from '../src/ui/RuleList';
import { companyCalendar, companyCalendarDef, holidays, makeRule, scheduleContext } from './helpers';

const salaryRule = makeRule({
  id: 'salary',
  title: '給与振込',
  color: 'blue',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
});

function gridFor(
  year: number,
  month: 1 | 4 | 9 | 10 | 12,
  rules: Rule[] = [],
  onSelectDay?: (date: string) => void,
  selectedDate: string | null = null,
): HTMLElement {
  const { occurrences } = expandRules(
    rules,
    { start: `${year}-${String(month).padStart(2, '0')}-01`, end: `${year}-${String(month).padStart(2, '0')}-28` },
    scheduleContext,
  );
  const ctx: MonthGridContext = {
    calendar: companyCalendar,
    holidays,
    occurrencesByDate: groupByDate(occurrences),
    today: '2026-09-04',
  };
  return renderCalendar(
    buildMonthGrid(year, month, ctx),
    new Map(rules.map((rule) => [rule.id, rule])),
    { onSelectDay: onSelectDay ?? (() => undefined) },
    selectedDate,
  );
}

describe('renderCalendar', () => {
  it('曜日ヘッダーと週の行を作る', () => {
    const table = gridFor(2026, 9);
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      '日', '月', '火', '水', '木', '金', '土',
    ]);
    expect(table.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(table.querySelectorAll('tbody td')).toHaveLength(35);
  });

  it('日曜・祝日は is-red、土曜は is-blue', () => {
    const table = gridFor(2026, 9);
    const cells = [...table.querySelectorAll('tbody td')];
    const byDay = (day: string): Element | undefined =>
      cells.find((cell) => cell.querySelector('.cell-day')?.textContent === day);

    expect(byDay('6')?.className).toContain('is-red'); // 日曜
    expect(byDay('5')?.className).toContain('is-blue'); // 土曜
    expect(byDay('21')?.className).toContain('is-red'); // 敬老の日(月)
    expect(byDay('21')?.className).toContain('is-closed');
    expect(byDay('4')?.className).not.toContain('is-closed'); // 平日
  });

  it('今日と月外の日を区別する', () => {
    const table = gridFor(2026, 9);
    expect(table.querySelectorAll('.is-today')).toHaveLength(1);
    expect(table.querySelector('.is-today .cell-day')?.textContent).toBe('4');
    expect(table.querySelectorAll('.is-outside').length).toBeGreaterThan(0);
  });

  it('祝日名と年末年始休業のラベルを出す', () => {
    const september = gridFor(2026, 9);
    expect([...september.querySelectorAll('.cell-closed')].map((e) => e.textContent)).toContain(
      '敬老の日',
    );
    const december = gridFor(2026, 12);
    expect([...december.querySelectorAll('.cell-closed')].map((e) => e.textContent)).toContain(
      '年末年始休業',
    );
  });

  it('年末年始休業と祝日が重なる日は祝日名を優先する', () => {
    const january = gridFor(2026, 1);
    const cells = [...january.querySelectorAll('tbody td')];
    const labelOf = (day: string): string | null | undefined =>
      cells
        .find((cell) => cell.querySelector('.cell-day')?.textContent === day)
        ?.querySelector('.cell-closed')?.textContent;

    expect(labelOf('1')).toBe('元日'); // 元日かつ年末年始休業
    expect(labelOf('2')).toBe('年末年始休業'); // 祝日ではない休業日
    expect(labelOf('12')).toBe('成人の日');
  });

  it('補正された予定に向きと元の日を出す', () => {
    // 2026-04-25(土) → 04-24(金)
    const table = gridFor(2026, 4, [salaryRule]);
    const chips = [...table.querySelectorAll('.chip')];
    expect(chips).toHaveLength(1);
    const chip = chips[0];
    expect(chip?.querySelector('.chip-mark')?.textContent).toBe('←25');
    expect(chip?.querySelector('.chip-mark')?.getAttribute('aria-label')).toBe('25日から前倒し');
    expect(chip?.querySelector('.chip-label')?.textContent).toBe('給与振込');
    expect(chip?.getAttribute('title')).toContain('本来は 2026-04-25');
    expect(chip?.getAttribute('title')).toContain('前営業日へ');
    expect(chip?.className).toContain('color-blue');
  });

  it('補正されていない予定に ⟳ は付かない', () => {
    // 2026-09-25 は金曜で営業日。
    const table = gridFor(2026, 9, [salaryRule]);
    expect(table.querySelectorAll('.chip')).toHaveLength(1);
    expect(table.querySelectorAll('.chip-mark')).toHaveLength(0);
  });

  it('事前通知は is-notice で描かれる', () => {
    const withNotice = makeRule({
      ...salaryRule,
      notices: [{ offset: -3, unit: 'business', label: '振込データ作成' }],
    });
    const table = gridFor(2026, 9, [withNotice]);
    const notice = table.querySelector('.chip.is-notice');
    expect(notice?.querySelector('.chip-label')?.textContent).toBe('給与振込: 振込データ作成');
    expect(notice?.getAttribute('title')).toContain('振込データ作成');
  });

  it('上限を超えたチップは「＋N件」にまとめる', () => {
    const rules = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      makeRule({
        id,
        title: `予定${id}`,
        recurrence: { type: 'monthlyByDay', interval: 1, days: [15], overflow: 'clamp' },
        adjust: { mode: 'none', keepInMonth: false },
      }),
    );
    const table = gridFor(2026, 9, rules);
    const cell = [...table.querySelectorAll('tbody td')].find(
      (node) => node.querySelector('.cell-day')?.textContent === '15',
    );
    expect(cell?.querySelectorAll('.chip:not(.chip-more)')).toHaveLength(MAX_CHIPS_PER_CELL);
    expect(cell?.querySelector('.chip-more')?.textContent).toBe('＋2件');
  });

  it('日付と「＋N件」から当日の詳細を開ける', () => {
    const onSelectDay = vi.fn();
    const table = gridFor(2026, 9, [], onSelectDay);
    const dayButton = [...table.querySelectorAll<HTMLButtonElement>('.cell-day')].find(
      (node) => node.textContent === '4',
    );
    dayButton?.dispatchEvent(new MouseEvent('click'));
    expect(onSelectDay).toHaveBeenCalledWith('2026-09-04');
  });

  it('選択中の日にしるしを付ける', () => {
    const table = gridFor(2026, 9, [], undefined, '2026-09-10');
    const selected = table.querySelectorAll('.is-selected');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.querySelector('.cell-day')?.textContent).toBe('10');
  });

  it('both のルールは同じ日から前後2件に分かれる', () => {
    const rule = makeRule({
      id: 'incoming',
      title: '入金予定',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
      adjust: { mode: 'both', keepInMonth: false },
    });
    // 2026-10-10(土) → 10-09 と 10-13
    const table = gridFor(2026, 10, [rule]);
    const marks = [...table.querySelectorAll('.chip-mark')].map((node) => node.textContent);
    expect(marks).toEqual(['←10', '→10']);
  });

  it('ルール名の HTML はエスケープされる', () => {
    const evil = makeRule({
      ...salaryRule,
      title: '<img src=x onerror="alert(1)">',
      note: '</td><script>alert(2)</script>',
    });
    const table = gridFor(2026, 4, [evil]);
    expect(table.querySelector('img')).toBeNull();
    expect(table.querySelector('script')).toBeNull();
    expect(table.querySelector('.chip-label')?.textContent).toBe('<img src=x onerror="alert(1)">');
  });
});

describe('renderLegend', () => {
  it('事前通知があるときだけ破線の説明を出す', () => {
    expect(renderLegend(false, false).textContent).not.toContain('破線');
    expect(renderLegend(true, false).textContent).toContain('破線');
    expect(renderLegend(false, true).textContent).toContain('数字は元の日');
    expect(renderLegend(false, false).textContent).toContain('前後の営業日へ移動');
    expect(renderLegend(false, false).textContent).toContain('日付をクリック');
  });
});

describe('renderRuleList', () => {
  const calendars = new Map<string, BusinessCalendar>([['company', companyCalendarDef]]);

  const handlers = (): RuleListHandlers => ({
    onLoadSamples: vi.fn(),
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onToggle: vi.fn(),
    onOpenSettings: vi.fn(),
  });

  const clickByText = (root: ParentNode, text: string): void => {
    const target = [...root.querySelectorAll('button')].find((b) => b.textContent === text);
    target?.dispatchEvent(new MouseEvent('click'));
  };

  it('ルールが無ければサンプル読み込みを促す', () => {
    const h = handlers();
    const section = renderRuleList([], calendars, h);
    clickByText(section, 'サンプルを読み込む');
    expect(h.onLoadSamples).toHaveBeenCalledOnce();
  });

  it('追加と設定を呼べる', () => {
    const h = handlers();
    const section = renderRuleList([], calendars, h);
    clickByText(section, '＋ 追加');
    clickByText(section, '設定');
    expect(h.onAdd).toHaveBeenCalledOnce();
    expect(h.onOpenSettings).toHaveBeenCalledOnce();
  });

  it('編集と有効/無効の切り替えを呼べる', () => {
    const h = handlers();
    const section = renderRuleList([salaryRule], calendars, h);
    clickByText(section, '編集');
    expect(h.onEdit).toHaveBeenCalledWith('salary');

    const toggle = section.querySelector<HTMLInputElement>('.switch input');
    expect(toggle?.checked).toBe(true);
    toggle!.checked = false;
    toggle?.dispatchEvent(new Event('change'));
    expect(h.onToggle).toHaveBeenCalledWith('salary', false);
  });

  it('ルールの説明・カレンダー名・通知を出す', () => {
    const rule = makeRule({
      ...salaryRule,
      calendarId: 'company',
      note: '支給日',
      notices: [{ offset: -3, unit: 'business', label: '振込データ作成' }],
      period: { start: '2026-04-01', end: null },
      skipDates: ['2026-08-25'],
    });
    const section = renderRuleList([rule], calendars, handlers());
    expect(section.querySelector('.rule-title')?.textContent).toBe('給与振込');
    expect(section.querySelector('.rule-desc')?.textContent).toBe('毎月25日 / 休業日なら前営業日');
    const meta = section.querySelector('.rule-meta')?.textContent ?? '';
    expect(meta).toContain('自社カレンダー');
    expect(meta).toContain('3営業日前: 振込データ作成');
    expect(meta).toContain('2026-04-01 〜');
    expect(meta).toContain('除外 1 件');
    expect(section.querySelector('.rule-note')?.textContent).toBe('支給日');
  });

  it('無効なルールに印を付ける', () => {
    const section = renderRuleList([makeRule({ ...salaryRule, enabled: false })], calendars, handlers());
    expect(section.querySelector('.rule')?.className).toContain('is-disabled');
    expect(section.querySelector('.rule-badge')?.textContent).toBe('無効');
  });

  it('未定義のカレンダーを明示する', () => {
    const section = renderRuleList(
      [makeRule({ ...salaryRule, calendarId: 'missing' })],
      calendars,
      handlers(),
    );
    expect(section.querySelector('.rule-calendar')?.textContent).toBe('missing（未定義）');
  });
});
