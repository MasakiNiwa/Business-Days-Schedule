/**
 * @vitest-environment jsdom
 *
 * 「AIで予定を作る」の画面（docs/SPEC.md §9.5）。
 *
 * コピー → 貼り付け → 確認 → 登録。登録は〈この内容で登録〉を押したときだけ。
 */

import { describe, expect, it, vi } from 'vitest';
import { AI_IMPORT_FORMAT } from '../src/core/aiImport';
import { buildAiPrompt } from '../src/core/aiPrompt';
import { previewSeries } from '../src/core/schedule';
import { AiImportView } from '../src/ui/AiImportView';
import type { AiImportHandlers } from '../src/ui/AiImportView';
import type { Rule } from '../src/types';
import { bankCalendarDef, companyCalendarDef, scheduleContext } from './helpers';

const calendars = [companyCalendarDef, bankCalendarDef];

const reply = (rules: unknown[]): string =>
  `以下の設定になります。\n\n\`\`\`json\n${JSON.stringify({ format: AI_IMPORT_FORMAT, schemaVersion: 1, rules }, null, 2)}\n\`\`\`\n\n必要に応じて調整してください。`;

const payment = {
  title: '支払',
  calendarId: 'bank',
  recurrence: { type: 'monthlyByDay', days: [25] },
  adjust: { mode: 'prev' },
  notices: [
    { label: '振込データ作成', timing: { kind: 'offset', offset: -3, unit: 'business' } },
    { label: '支払確認', timing: { kind: 'offset', offset: 1, unit: 'business' } },
  ],
};

function setup(copied = true) {
  const handlers = {
    copyText: vi.fn<AiImportHandlers['copyText']>().mockResolvedValue(copied),
    onRegister: vi.fn<AiImportHandlers['onRegister']>(),
    onClose: vi.fn<AiImportHandlers['onClose']>(),
  };
  const view = new AiImportView(calendars, scheduleContext, '2026-10-01', handlers);
  document.body.replaceChildren(view.element);
  return { view, handlers, root: view.element };
}

const buttonOf = (root: ParentNode, text: string): HTMLButtonElement => {
  const target = [...root.querySelectorAll('button')].find((node) => node.textContent === text);
  if (target === undefined) throw new Error(`ボタンが見つかりません: ${text}`);
  return target;
};
const click = (root: ParentNode, text: string): void => {
  buttonOf(root, text).dispatchEvent(new MouseEvent('click'));
};

function paste(root: HTMLElement, text: string): void {
  const input = root.querySelector<HTMLTextAreaElement>('.ai-import-input');
  if (input === null) throw new Error('貼り付け欄が見つかりません');
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

describe('AiImportView', () => {
  it('3つの手順を順に並べる', () => {
    const { root } = setup();
    const steps = [...root.querySelectorAll('.ai-step-title')].map((node) => node.textContent);
    expect(steps).toEqual(['AIへの依頼文をコピー', 'AIに予定を伝える', 'AIの回答を貼り付け']);
    // 貼り付け欄には名前がある。
    expect(root.querySelector('label')?.textContent).toBe('AIから返ってきた内容を貼り付け');
  });

  it('〈AIへの依頼文をコピー〉で依頼文を写す', async () => {
    const { root, handlers } = setup();
    click(root, 'AIへの依頼文をコピー');
    await vi.waitFor(() => expect(root.querySelector('.ai-copy-status')?.textContent).toContain('コピーしました'));
    expect(handlers.copyText).toHaveBeenCalledWith(buildAiPrompt(calendars));
  });

  it('写せない環境では、その場で選んでコピーできるようにする', async () => {
    const { root } = setup(false);
    click(root, 'AIへの依頼文をコピー');
    await vi.waitFor(() => expect(root.querySelector('.ai-copy-status')?.textContent).toContain('コピーできませんでした'));
    const box = root.querySelector<HTMLDetailsElement>('.ai-copy-box');
    expect(box?.open).toBe(true);
    expect(box?.querySelector('textarea')?.value).toBe(buildAiPrompt(calendars));
  });

  it('正しい回答なら、このアプリの計算で直近の日付を見せる（まだ登録しない）', () => {
    const { root, handlers } = setup();
    paste(root, reply([payment]));
    click(root, '内容を確認');

    expect(handlers.onRegister).not.toHaveBeenCalled();
    expect(root.querySelector('.ai-result-title')?.textContent).toBe('AIから次の予定が作成されました（1 件）');
    const card = root.querySelector('.ai-preview-item');
    expect(card?.querySelector('.rule-title')?.textContent).toBe('支払');
    expect(card?.querySelector('.rule-desc')?.textContent).toBe('毎月25日 / 休業日なら前営業日');
    expect(card?.textContent).toContain('3営業日前: 振込データ作成');

    // 画面の日付は previewSeries と一致する。
    const shown = [...(card?.querySelectorAll('.preview-list > li > .preview-date') ?? [])].map((n) => n.textContent);
    expect(shown).toEqual(['2026-10-23', '2026-11-25', '2026-12-25']);
    expect(card?.textContent).toContain('2026-10-25（日）が休業日のため前営業日へ');
    // 手順は畳む。スマートフォンで確認画面まで遠くならないように。
    expect(root.querySelector<HTMLElement>('.ai-steps')?.hidden).toBe(true);
  });

  it('〈この内容で登録〉を押して初めて登録する', () => {
    const { root, handlers } = setup();
    paste(root, reply([payment, { title: '月次締め', recurrence: { type: 'monthlyByDay', days: ['last'] }, adjust: { mode: 'none' } }]));
    click(root, '内容を確認');
    click(root, 'この内容で登録（2 件）');
    expect(handlers.onRegister).toHaveBeenCalledTimes(1);
    const rules = handlers.onRegister.mock.calls[0]?.[0] as Rule[];
    expect(rules.map((rule) => rule.title)).toEqual(['支払', '月次締め']);
    // 確認画面の日付は、登録するルールそのものを計算したもの。
    expect(previewSeries(rules[0] as Rule, '2026-10-01', 1, scheduleContext)[0]?.main.date).toBe('2026-10-23');
  });

  it('キャンセルでは登録しない', () => {
    const { root, handlers } = setup();
    paste(root, reply([payment]));
    click(root, '内容を確認');
    click(root, 'キャンセル');
    expect(handlers.onClose).toHaveBeenCalled();
    expect(handlers.onRegister).not.toHaveBeenCalled();
  });

  it('〈貼り直す〉で入力に戻る。貼った内容は残す', () => {
    const { root } = setup();
    paste(root, reply([payment]));
    click(root, '内容を確認');
    click(root, '貼り直す');
    expect(root.querySelector<HTMLElement>('.ai-steps')?.hidden).toBe(false);
    expect(root.querySelector('.ai-review')).toBeNull();
    expect(root.querySelector<HTMLTextAreaElement>('.ai-import-input')?.value).toContain('"支払"');
  });

  it('読み込めなければ、分かる言葉で理由を出し、登録の手段を出さない', () => {
    const { root, handlers } = setup();
    paste(root, reply([{ ...payment, adjust: { mode: 'previousBusinessDay' } }]));
    click(root, '内容を確認');

    expect(root.querySelector('.ai-result-title')?.textContent).toBe('AIの回答を読み込めませんでした');
    expect(root.querySelector('.ai-issues')?.textContent).toContain(
      '1件目「支払」: AIから返された「休業日の扱い」に、このアプリでは使えない設定（"previousBusinessDay"）が含まれています。',
    );
    // 技術的な詳細は畳んだ中に置く。
    const technical = root.querySelector('.ai-technical');
    expect(technical?.closest('details')?.open).toBe(false);
    expect(technical?.textContent).toContain('rules[0].adjust.mode');
    expect([...root.querySelectorAll('button')].some((b) => b.textContent?.startsWith('この内容で登録'))).toBe(false);
    expect(handlers.onRegister).not.toHaveBeenCalled();
  });

  it('〈AIへ修正を依頼する文をコピー〉で直し方を写す', async () => {
    const { root, handlers } = setup();
    paste(root, reply([{ ...payment, adjust: { mode: 'previousBusinessDay' } }]));
    click(root, '内容を確認');
    click(root, 'AIへ修正を依頼する文をコピー');
    await vi.waitFor(() => expect(handlers.copyText).toHaveBeenCalled());
    const text = handlers.copyText.mock.calls[0]?.[0] ?? '';
    expect(text).toContain('Business Days Schedule で読み込めませんでした');
    expect(text).toContain('rules[0].adjust.mode');
  });

  it('JSON の構文が崩れていてもエラーとして返す（推測で直さない）', () => {
    const { root, handlers } = setup();
    paste(root, '```json\n{ "format": "business-days-schedule-ai-import", "rules": [ } \n```');
    click(root, '内容を確認');
    expect(root.querySelector('.ai-issues')?.textContent).toContain('書き方が崩れていて');
    expect(handlers.onRegister).not.toHaveBeenCalled();
  });

  it('HTML を含む名前は文字として出し、要素として解釈しない', () => {
    const { root } = setup();
    paste(root, reply([{ ...payment, title: '<img src=x onerror="globalThis.__xss=1">', note: '<script>globalThis.__xss=1</script>' }]));
    click(root, '内容を確認');
    expect(root.querySelector('.ai-preview-item img')).toBeNull();
    expect(root.querySelector('.ai-preview-item script')).toBeNull();
    expect(root.querySelector('.ai-preview-item .rule-title')?.textContent).toBe('<img src=x onerror="globalThis.__xss=1">');
    expect((globalThis as Record<string, unknown>)['__xss']).toBeUndefined();
  });

  it('警告は確認画面に出すが、登録は止めない', () => {
    const { root } = setup();
    paste(root, reply([{ title: '1on1', recurrence: { type: 'weekly', interval: 2, weekdays: [3] }, adjust: { mode: 'none' } }]));
    click(root, '内容を確認');
    expect(root.querySelector('.ai-review .issue-warning')?.textContent).toContain('基準日が指定されていない');
    expect(buttonOf(root, 'この内容で登録').disabled).toBe(false);
  });

  it('貼り付けた内容があるときだけ「変更あり」', () => {
    const { root, view } = setup();
    expect(view.isDirty()).toBe(false);
    paste(root, '{');
    expect(view.isDirty()).toBe(true);
  });
});
