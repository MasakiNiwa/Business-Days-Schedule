/**
 * @vitest-environment jsdom
 *
 * 編集画面の「詳細」（docs/SPEC.md §8.4）。
 *
 * 使う人が限られる設定は折りたたみの中に置き、ふだんの画面を短く保つ。
 * 設定してあるものは開いて見せる。
 */

import { describe, expect, it, vi } from 'vitest';
import { RuleEditor } from '../src/ui/RuleEditor';
import type { Rule } from '../src/types';
import { bankCalendarDef, companyCalendarDef, makeRule, scheduleContext } from './helpers';

const calendars = [companyCalendarDef, bankCalendarDef];

function open(rule: Rule) {
  const onSave = vi.fn<(rule: Rule) => void>();
  const editor = new RuleEditor(rule, calendars, scheduleContext, { onSave, onCancel: vi.fn() }, false, '2026-10-01', []);
  document.body.replaceChildren(editor.element);
  return { form: editor.element, onSave };
}

const tab = (form: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...form.querySelectorAll<HTMLButtonElement>('.tab')].find((b) => b.textContent === label);
  if (found === undefined) throw new Error(`タブが見つかりません: ${label}`);
  return found;
};

const byLabel = <T extends HTMLElement>(form: HTMLElement, label: string): T => {
  const found = form.querySelector<T>(`[aria-label="${label}"]`);
  if (found === null) throw new Error(`欄が見つかりません: ${label}`);
  return found;
};

const save = (form: HTMLFormElement): void => {
  form.dispatchEvent(new Event('submit', { cancelable: true }));
};

const salary = makeRule({
  id: 'salary',
  title: '給与振込',
  calendarId: 'bank',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
  notices: [{ id: 'n1', label: '振込データ作成', timing: { kind: 'offset', offset: -3, unit: 'business' } }],
});

describe('繰り返し方の詳細', () => {
  it('よく使う4つは常に見せ、決算月基準・毎営業日は畳んでおく', () => {
    const { form } = open(salary);
    const visible = [...form.querySelectorAll('.editor-section > .tabs .tab')].map((b) => b.textContent);
    expect(visible).toEqual(['毎月N日', '第N営業日', '第N曜日', '毎週']);
    const extra = form.querySelector<HTMLDetailsElement>('details.recurrence-extra');
    expect(extra?.open).toBe(false);
    expect([...(extra?.querySelectorAll('.tab') ?? [])].map((b) => b.textContent)).toEqual([
      '決算月基準',
      '毎営業日・N営業日ごと',
    ]);
  });

  it('詳細の繰り返し方を使っているルールは、開いて見せる', () => {
    const { form } = open(makeRule({ title: '残高確認', recurrence: { type: 'businessDays', interval: 1 } }));
    expect(form.querySelector<HTMLDetailsElement>('details.recurrence-extra')?.open).toBe(true);
    expect(tab(form, '毎営業日・N営業日ごと').getAttribute('aria-pressed')).toBe('true');
  });

  it('毎営業日を選ぶと休業日の補正は出さず、5営業日ごとにすると数え始めの日を問う', () => {
    const { form, onSave } = open(salary);
    tab(form, '毎営業日・N営業日ごと').click();
    expect(tab(form, '毎月N日').getAttribute('aria-pressed')).toBe('false');
    expect(form.querySelector<HTMLElement>('.adjust-controls')?.hidden).toBe(true);

    const anchor = [...form.querySelectorAll<HTMLElement>('.field')].find((f) =>
      f.textContent?.startsWith('数え始める日'),
    );
    expect(anchor?.hidden).toBe(true);
    const interval = [...form.querySelectorAll<HTMLElement>('.field')]
      .find((f) => f.textContent?.startsWith('間隔'))
      ?.querySelector<HTMLInputElement>('input[type="number"]');
    interval!.value = '5';
    interval!.dispatchEvent(new Event('input'));
    expect(anchor?.hidden).toBe(false);

    save(form);
    // 数え始めの日は今日で埋めて見せる（決めずに保存すると、どの日に出るかが読めない）。
    expect(anchor?.querySelector('input')?.value).toBe('2026-10-01');
    expect(onSave.mock.calls[0]?.[0].recurrence).toEqual({ type: 'businessDays', interval: 5, anchor: '2026-10-01' });
    expect(onSave.mock.calls[0]?.[0].adjust.mode).toBe('none');
  });
});

describe('休業日ならその回は行わない', () => {
  it('休業日の扱いで選べ、「月をまたがない」は出さない', () => {
    const { form, onSave } = open(salary);
    const mode = form.querySelector<HTMLSelectElement>('.adjust-controls select')!;
    expect(form.querySelector(`label[for="${mode.id}"]`)?.textContent).toBe('休業日の場合');
    expect([...mode.options].map((o) => o.value)).toContain('skip');
    mode.value = 'skip';
    mode.dispatchEvent(new Event('change'));
    expect(form.querySelector<HTMLElement>('.adjust-controls .checkbox')?.hidden).toBe(true);
    save(form);
    expect(onSave.mock.calls[0]?.[0].adjust.mode).toBe('skip');
  });
});

describe('前後の予定の詳細', () => {
  it('予定ごとに畳んだ詳細があり、ふだんは閉じている', () => {
    const { form } = open(salary);
    const details = form.querySelector<HTMLDetailsElement>('.notice-item details.notice-details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('詳細（数える営業日カレンダー・休業日のとき）');
  });

  it('数える営業日カレンダーを選ぶと保存され、説明にも出る', () => {
    const { form, onSave } = open(salary);
    const select = byLabel<HTMLSelectElement>(form, '1 件目: 数える営業日カレンダー');
    expect([...select.options].map((o) => o.textContent)).toEqual(['本体と同じ', '自社カレンダー', '銀行休業日']);
    select.value = 'company';
    select.dispatchEvent(new Event('change'));
    expect(form.querySelector('.notice-summary')?.textContent).toContain('（自社カレンダーで数える）');
    save(form);
    expect(onSave.mock.calls[0]?.[0].notices[0]?.calendarId).toBe('company');

    select.value = '';
    select.dispatchEvent(new Event('change'));
    save(form);
    expect(onSave.mock.calls[1]?.[0].notices[0]).not.toHaveProperty('calendarId');
  });

  it('「数えた先が休業日なら」は暦日で数えるときだけ出し、保存される', () => {
    const { form, onSave } = open(salary);
    const onClosed = form.querySelector<HTMLElement>('.notice-on-closed');
    expect(onClosed?.hidden).toBe(true);

    const unit = byLabel<HTMLSelectElement>(form, '1 件目: 単位');
    unit.value = 'calendar';
    unit.dispatchEvent(new Event('change'));
    expect(onClosed?.hidden).toBe(false);

    const choice = byLabel<HTMLSelectElement>(form, '1 件目: 暦日で数えた先が休業日のとき');
    choice.value = 'prev';
    choice.dispatchEvent(new Event('change'));
    save(form);
    expect(onSave.mock.calls[0]?.[0].notices[0]?.timing).toEqual({
      kind: 'offset',
      offset: -3,
      unit: 'calendar',
      onClosed: 'prev',
    });

    // 営業日へ戻すと持たない（営業日で数えれば必ず営業日なので）。
    unit.value = 'business';
    unit.dispatchEvent(new Event('change'));
    save(form);
    expect(onSave.mock.calls[1]?.[0].notices[0]?.timing).toEqual({ kind: 'offset', offset: -3, unit: 'business' });
  });

  it('詳細を設定済みの予定は、開いて見せる', () => {
    const { form } = open({
      ...salary,
      notices: [{ id: 'n1', label: '承認', timing: { kind: 'offset', offset: -3, unit: 'business' }, calendarId: 'company' }],
    });
    expect(form.querySelector<HTMLDetailsElement>('details.notice-details')?.open).toBe(true);
  });
});
