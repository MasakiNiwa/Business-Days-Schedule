/**
 * @vitest-environment jsdom
 *
 * ルール編集フォーム（docs/SPEC.md §8.4）。
 * 中心はプレビュー — 入力を変えると実際の日付がその場で更新されること、
 * 不正な設定では保存できないことを固定する。
 */

import { describe, expect, it, vi } from 'vitest';
import { RuleEditor } from '../src/ui/RuleEditor';
import type { RuleEditorHandlers } from '../src/ui/RuleEditor';
import type { Rule } from '../src/types';
import { companyCalendarDef, bankCalendarDef, makeRule, scheduleContext } from './helpers';

const TODAY = '2026-09-04';
const calendars = [companyCalendarDef, bankCalendarDef];

function open(
  rule: Rule,
  handlers: Partial<RuleEditorHandlers> = {},
  isNew = false,
): { editor: RuleEditor; form: HTMLFormElement; handlers: RuleEditorHandlers } {
  const full: RuleEditorHandlers = {
    onSave: vi.fn(),
    onCancel: vi.fn(),
    onDelete: vi.fn(),
    ...handlers,
  };
  const editor = new RuleEditor(rule, calendars, scheduleContext, full, isNew, TODAY);
  return { editor, form: editor.element, handlers: full };
}

const previewDates = (form: HTMLFormElement): string[] =>
  [...form.querySelectorAll('.preview-date')].map((node) => node.textContent ?? '');

const clickText = (root: ParentNode, text: string): void => {
  const target = [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  if (target === undefined) throw new Error(`ボタンが見つかりません: ${text}`);
  target.dispatchEvent(new MouseEvent('click'));
};

const salary = makeRule({
  id: 'salary',
  title: '給与振込',
  calendarId: 'bank',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
});

describe('プレビュー', () => {
  it('初期表示で次の10回を出す', () => {
    const { form } = open(salary);
    expect(previewDates(form)).toEqual([
      '2026-09-25', '2026-10-23', '2026-11-25', '2026-12-25', '2027-01-25',
      '2027-02-25', '2027-03-25', '2027-04-23', '2027-05-25', '2027-06-25',
    ]);
  });

  it('補正された回に元の日付を出す', () => {
    const { form } = open(salary);
    const shifted = [...form.querySelectorAll('.preview-list li.is-shifted')];
    expect(shifted.length).toBeGreaterThan(0);
    expect(shifted[0]?.textContent).toContain('2026-10-25');
    expect(shifted[0]?.textContent).toContain('← 2026-10-25 から前倒し');
  });

  it('補正の向きを変えるとプレビューが即座に変わる', () => {
    const { form } = open(salary);
    const before = previewDates(form);

    const modeSelect = form.querySelector<HTMLSelectElement>('select');
    // 「休業日にあたったとき」の補正セレクトを探す。
    const adjustSelect = [...form.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'nearest'),
    );
    expect(adjustSelect).toBeDefined();
    expect(modeSelect).toBeDefined();

    adjustSelect!.value = 'next';
    adjustSelect!.dispatchEvent(new Event('change'));

    const after = previewDates(form);
    expect(after).not.toEqual(before);
    // 2026-10-25(日) は翌営業日 10-26(月) になる。
    expect(after).toContain('2026-10-26');
  });

  it('日のトグルを押すとプレビューに反映される', () => {
    const { form } = open(salary);
    const dayToggles = form.querySelectorAll('.toggles-days .toggle');
    expect(dayToggles).toHaveLength(31); // 1〜30 と「31 / 末日」

    // 10日を追加する。
    const tenth = [...dayToggles].find((t) => t.textContent === '10');
    tenth?.dispatchEvent(new MouseEvent('click'));
    expect(tenth?.getAttribute('aria-pressed')).toBe('true');

    const dates = previewDates(form);
    expect(dates).toContain('2026-09-10');
    expect(dates).toContain('2026-09-25');
  });

  it('種類を切り替えると入力欄とプレビューが入れ替わる', () => {
    const { form } = open(salary);
    clickText(form, '第N営業日');
    expect(form.querySelector('.toggles-days')).toBeNull();
    // 既定の第5営業日。2026-09 の第5営業日は 09-07。
    expect(previewDates(form)[0]).toBe('2026-09-07');
  });

  it('発生しない設定では警告を出す', () => {
    const expired = makeRule({ ...salary, period: { start: null, end: '2020-12-31' } });
    const { form } = open(expired);
    expect(form.querySelector('.preview-list')).toBeNull();
    expect(form.querySelector('.issue-warning')?.textContent).toContain('発生する日がありません');
  });
});

describe('31 と末日', () => {
  const monthEnd = makeRule({
    id: 'closing',
    title: '月次締め',
    recurrence: { type: 'monthlyByDay', interval: 1, days: ['last'], overflow: 'clamp' },
    adjust: { mode: 'prev', keepInMonth: false },
  });

  it('31 と末日はひとつのトグルにまとめる', () => {
    const { form } = open(monthEnd);
    const labels = [...form.querySelectorAll('.toggles-days .toggle')].map((t) => t.textContent);
    expect(labels.at(-1)).toBe('31 / 末日');
    expect(labels).not.toContain('31');
  });

  it('末日のルールを開くとそのトグルが押された状態になる', () => {
    const { form } = open(monthEnd);
    const last = [...form.querySelectorAll('.toggles-days .toggle')].at(-1);
    expect(last?.getAttribute('aria-pressed')).toBe('true');
  });

  it('以前の版の 31 も同じトグルとして扱う', () => {
    const legacy = makeRule({
      ...monthEnd,
      recurrence: { type: 'monthlyByDay', interval: 1, days: [31], overflow: 'clamp' },
    });
    const { form, handlers } = open(legacy);
    const last = [...form.querySelectorAll('.toggles-days .toggle')].at(-1);
    expect(last?.getAttribute('aria-pressed')).toBe('true');

    // 触ると内部表現も 'last' に寄る。
    const tenth = [...form.querySelectorAll('.toggles-days .toggle')].find(
      (t) => t.textContent === '10',
    );
    tenth?.dispatchEvent(new MouseEvent('click'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(vi.mocked(handlers.onSave).mock.calls[0]?.[0]?.recurrence).toMatchObject({
      days: [10, 'last'],
    });
  });

  it('2月に無い日の扱いは 29・30 日を選んだときだけ出す', () => {
    const { form } = open(monthEnd);
    const overflowField = [...form.querySelectorAll<HTMLElement>('.field')].find((node) =>
      node.textContent?.includes('2月に無い日の扱い'),
    );
    expect(overflowField?.hidden).toBe(true);

    const thirtieth = [...form.querySelectorAll('.toggles-days .toggle')].find(
      (t) => t.textContent === '30',
    );
    thirtieth?.dispatchEvent(new MouseEvent('click'));
    expect(overflowField?.hidden).toBe(false);
  });
});

describe('検証', () => {
  it('タイトルが空なら保存できない', () => {
    const { form, handlers } = open(makeRule({ ...salary, title: '' }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(handlers.onSave).not.toHaveBeenCalled();
    expect([...form.querySelectorAll('.issue-error')].map((n) => n.textContent)).toContain(
      'タイトルを入力してください',
    );
  });

  it('検証に通れば保存できる', () => {
    const { form, handlers } = open(salary);
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(handlers.onSave).toHaveBeenCalledOnce();
    const saved = vi.mocked(handlers.onSave).mock.calls[0]?.[0];
    expect(saved?.title).toBe('給与振込');
    expect(saved?.id).toBe('salary');
  });

  it('エラー中はプレビューを出さない', () => {
    const { form } = open(makeRule({ ...salary, title: '' }));
    expect(form.querySelector('.preview-list')).toBeNull();
    expect(form.querySelector('.preview-body')?.textContent).toContain('設定を修正すると');
  });
});

describe('編集操作', () => {
  it('編集内容が保存時に反映される', () => {
    const { form, handlers } = open(salary);
    const titleInput = form.querySelector<HTMLInputElement>('input[type="text"]');
    titleInput!.value = '給与振込（改）';
    titleInput?.dispatchEvent(new Event('input'));

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(vi.mocked(handlers.onSave).mock.calls[0]?.[0]?.title).toBe('給与振込（改）');
  });

  it('元のルールを直接書き換えない', () => {
    const original = makeRule({ ...salary });
    const { form } = open(original);
    const titleInput = form.querySelector<HTMLInputElement>('input[type="text"]');
    titleInput!.value = '別の名前';
    titleInput?.dispatchEvent(new Event('input'));
    expect(original.title).toBe('給与振込');
  });

  it('事前通知を追加・削除できる', () => {
    const { form, handlers } = open(salary);
    clickText(form, '＋ 事前通知を追加');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(vi.mocked(handlers.onSave).mock.calls[0]?.[0]?.notices).toEqual([
      { offset: -3, unit: 'business', label: '準備' },
    ]);
  });

  it('除外日を追加できる', () => {
    const { form, handlers } = open(salary);
    const picker = form.querySelector<HTMLInputElement>('.skip-date-picker');
    picker!.value = '2026-12-25';
    clickText(form, '除外に追加');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(vi.mocked(handlers.onSave).mock.calls[0]?.[0]?.skipDates).toEqual(['2026-12-25']);
  });

  it('対象月のプリセットで四半期にできる', () => {
    const { form, handlers } = open(salary);
    clickText(form, '四半期 (3・6・9・12月)');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    const saved = vi.mocked(handlers.onSave).mock.calls[0]?.[0];
    expect(saved?.recurrence).toMatchObject({ months: [3, 6, 9, 12] });
    expect(previewDates(form).slice(0, 3)).toEqual(['2026-09-25', '2026-12-25', '2027-03-25']);
  });

  it('新規作成では削除ボタンを出さない', () => {
    const { form } = open(makeRule({ title: '新規' }), {}, true);
    const labels = [...form.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).not.toContain('削除');
    expect(form.querySelector('.editor-title')?.textContent).toBe('ルールを追加');
  });

  it('既存ルールでは削除を呼べる', () => {
    const { form, handlers } = open(salary);
    clickText(form, '削除');
    expect(handlers.onDelete).toHaveBeenCalledWith('salary');
  });

  it('キャンセルを呼べる', () => {
    const { form, handlers } = open(salary);
    clickText(form, 'キャンセル');
    expect(handlers.onCancel).toHaveBeenCalledOnce();
  });
});
