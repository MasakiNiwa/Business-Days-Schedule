/**
 * @vitest-environment jsdom
 *
 * 「AIで予定を作る」の画面（docs/SPEC.md §9.5）。
 *
 * コピー → 貼り付け → 確認 → 登録。登録は〈この内容で登録〉を押したときだけ。
 */

import { describe, expect, it, vi } from 'vitest';
import { AI_IMPORT_FORMAT } from '../src/core/aiImport';
import { ruleSnapshot } from '../src/core/aiContext';
import { buildAiPrompt } from '../src/core/aiPrompt';
import { previewSeries } from '../src/core/schedule';
import { AiImportView } from '../src/ui/AiImportView';
import type { AiImportHandlers } from '../src/ui/AiImportView';
import type { Rule } from '../src/types';
import { bankCalendarDef, companyCalendarDef, makeRule, scheduleContext } from './helpers';

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
    const input = root.querySelector<HTMLTextAreaElement>('.ai-import-input');
    expect(root.querySelector(`label[for="${input?.id ?? ''}"]`)?.textContent).toBe('AIから返ってきた内容を貼り付け');
  });

  it('〈AIへの依頼文をコピー〉で依頼文を写す', async () => {
    const { root, handlers } = setup();
    click(root, 'AIへの依頼文をコピー');
    await vi.waitFor(() => expect(root.querySelector('.ai-copy-status')?.textContent).toContain('コピーしました'));
    expect(handlers.copyText).toHaveBeenCalledWith(buildAiPrompt({ calendars, groups: [] }));
  });

  it('写せない環境では、その場で選んでコピーできるようにする', async () => {
    const { root } = setup(false);
    click(root, 'AIへの依頼文をコピー');
    await vi.waitFor(() => expect(root.querySelector('.ai-copy-status')?.textContent).toContain('コピーできませんでした'));
    const box = root.querySelector<HTMLDetailsElement>('.ai-copy-box');
    expect(box?.open).toBe(true);
    expect(box?.querySelector('textarea')?.value).toBe(buildAiPrompt({ calendars, groups: [] }));
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

describe('AiImportView: 頼むことと渡す内容を選ぶ', () => {
  const saved = makeRule({
    id: 'pay',
    title: '支払',
    calendarId: 'bank',
    note: '取引先A社',
    recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
    adjust: { mode: 'prev', keepInMonth: false },
  });

  function setupWith(rules: Rule[]) {
    const handlers = {
      copyText: vi.fn<AiImportHandlers['copyText']>().mockResolvedValue(true),
      onRegister: vi.fn<AiImportHandlers['onRegister']>(),
      onClose: vi.fn<AiImportHandlers['onClose']>(),
    };
    const view = new AiImportView(calendars, scheduleContext, '2026-10-15', handlers, rules);
    document.body.replaceChildren(view.element);
    return { view, handlers, root: view.element };
  }

  const checkboxOf = (root: ParentNode, text: string): HTMLInputElement => {
    const label = [...root.querySelectorAll('label.checkbox')].find((node) => node.textContent?.startsWith(text));
    const input = label?.querySelector('input');
    if (input === null || input === undefined) throw new Error(`チェックボックスが見つかりません: ${text}`);
    return input;
  };

  it('予定が無ければ「新しく作る」だけを選べる', () => {
    const { root } = setupWith([]);
    expect(buttonOf(root, '新しく作る').getAttribute('aria-pressed')).toBe('true');
    expect(buttonOf(root, '今の予定を直す').disabled).toBe(true);
    expect(root.textContent).toContain('予定を登録すると選べます');
  });

  it('既定では登録内容を渡さず、渡す内容と長さを見せる', () => {
    const { root, view } = setupWith([saved]);
    expect(view.promptText).toBe(buildAiPrompt({ calendars, groups: [] }));
    expect(root.querySelector('.ai-share-summary')?.textContent).toContain('渡す登録内容: なし');
    expect(root.querySelector('.ai-share-summary')?.textContent).toMatch(/依頼文は約 [\d,]+ 文字です。/);
    expect(root.querySelector<HTMLElement>('.ai-share-note')?.hidden).toBe(true);
    // 渡す内容は畳んでおく。
    expect(root.querySelector<HTMLDetailsElement>('details.ai-share')?.open).toBe(false);
  });

  it('「今の予定を直す」では予定を渡し、メモは選んだときだけ渡す', async () => {
    const { root, view, handlers } = setupWith([saved]);
    click(root, '今の予定を直す');
    expect(view.promptText).toContain('"id":"pay"');
    expect(view.promptText).not.toContain('取引先A社');
    expect(root.querySelector('.ai-share-summary')?.textContent).toContain('予定 1 件');
    expect(root.querySelector<HTMLElement>('.ai-share-note')?.hidden).toBe(false);
    expect(root.querySelectorAll('.ai-step-title')[1]?.textContent).toBe('AIに直したいことを伝える');

    const notes = checkboxOf(root, 'メモも含める');
    notes.checked = true;
    notes.dispatchEvent(new Event('change'));
    expect(view.promptText).toContain('取引先A社');
    expect(root.querySelector('.ai-share-summary')?.textContent).toContain('（メモを含む）');

    // コピーするのは、見せている依頼文そのもの。
    click(root, 'AIへの依頼文をコピー');
    await vi.waitFor(() => expect(handlers.copyText).toHaveBeenCalledWith(view.promptText));
    expect(root.querySelector<HTMLTextAreaElement>('.ai-copy-box textarea')?.value).toBe(view.promptText);
  });

  it('予定を渡さないようにすると、メモの選択は効かない', () => {
    const { root } = setupWith([saved]);
    click(root, '今の予定を直す');
    const rules = checkboxOf(root, '登録済みの予定');
    rules.checked = false;
    rules.dispatchEvent(new Event('change'));
    expect(checkboxOf(root, 'メモも含める').disabled).toBe(true);
  });

  it('選び直しても選択欄を作り直さない（キーボードのフォーカスを失わない）', () => {
    const { root } = setupWith([saved]);
    const notes = checkboxOf(root, 'メモも含める');
    click(root, '今の予定を直す');
    notes.checked = true;
    notes.dispatchEvent(new Event('change'));
    expect(checkboxOf(root, 'メモも含める')).toBe(notes);
    // 頼むことを選び直すと、その既定（メモなし）に戻る。
    click(root, '点検してもらう');
    expect(notes.checked).toBe(false);
    expect(checkboxOf(root, '営業日カレンダーの決め方').checked).toBe(true);
  });

  it('「予定について質問」では、アプリが計算した予定の一覧を渡す', () => {
    const { root, view } = setupWith([saved]);
    click(root, '予定について質問');
    expect(view.promptText).toContain('2026-10-23（金） 支払');
    expect(root.querySelector('.ai-share-summary')?.textContent).toContain('予定の一覧（2026-10-01〜2026-12-31）');
    expect(root.querySelector<HTMLElement>('.ai-paste-hint')?.hidden).toBe(false);

    const months = root.querySelector<HTMLSelectElement>('select[aria-label="予定の一覧の期間"]')!;
    months.value = '1';
    months.dispatchEvent(new Event('change'));
    expect(root.querySelector('.ai-share-summary')?.textContent).toContain('予定の一覧（2026-10-01〜2026-10-31）');
  });

  it('最初に伝えることを書くと依頼文に入り、閉じる前に確かめる', () => {
    const { root, view } = setupWith([saved]);
    const request = root.querySelector<HTMLTextAreaElement>('.ai-request-input')!;
    request.value = '毎月10日に源泉税の納付があります。';
    request.dispatchEvent(new Event('input'));
    expect(view.promptText).toContain('# 利用者の最初の依頼\n毎月10日に源泉税の納付があります。');
    expect(view.isDirty()).toBe(true);
  });

  it('直す指示は、変更前と変更後を見せてから反映する', () => {
    const { root, handlers } = setupWith([saved]);
    paste(root, reply([{ ...ruleSnapshot(saved, false), adjust: { mode: 'next' } }]));
    click(root, '内容を確認');

    expect(root.querySelector('.ai-result-title')?.textContent).toBe('AIから次の内容が届きました（変更 1 件）');
    const card = root.querySelector('.ai-preview-update');
    expect(card?.querySelector('.ai-preview-badge')?.textContent).toBe('変更');
    expect(card?.querySelector('.ai-changes')?.textContent).toContain('変更前: 毎月25日 / 休業日なら前営業日');
    expect(card?.querySelector('.ai-changes')?.textContent).toContain('変更後: 毎月25日 / 休業日なら翌営業日');
    // 日付は変更後のルールをこのアプリで計算したもの。
    expect(card?.querySelector('.preview-list > li > .preview-date')?.textContent).toBe('2026-10-26');

    click(root, 'この内容で反映（変更 1 件）');
    const [added, updates] = handlers.onRegister.mock.calls[0] ?? [];
    expect(added).toEqual([]);
    expect(updates?.map((update) => update.after.adjust.mode)).toEqual(['next']);
    // メモは渡していないが、消えない。
    expect(updates?.[0]?.after.note).toBe('取引先A社');
  });

  it('追加と変更が混ざるときは、どちらかを印で分ける', () => {
    const { root } = setupWith([saved]);
    paste(root, reply([{ ...ruleSnapshot(saved, false), title: '支払（本社）' }, payment]));
    click(root, '内容を確認');
    expect(root.querySelector('.ai-result-title')?.textContent).toBe('AIから次の内容が届きました（追加 1 件・変更 1 件）');
    expect([...root.querySelectorAll('.ai-preview-badge')].map((node) => node.textContent)).toEqual(['変更', '追加']);
    expect(buttonOf(root, 'この内容で反映（追加 1 件・変更 1 件）')).toBeTruthy();
  });

  it('何も変わらない回答なら、反映のボタンを出さない', () => {
    const { root } = setupWith([saved]);
    paste(root, reply([ruleSnapshot(saved, false)]));
    click(root, '内容を確認');
    expect(root.querySelector('.ai-result-title')?.textContent).toBe('AIの回答に、変更する予定はありませんでした');
    expect(root.textContent).toContain('変更のない予定 1 件はそのままにします。');
    expect([...root.querySelectorAll('button')].some((b) => b.textContent?.startsWith('この内容で'))).toBe(false);
  });

  it('渡したあとでアプリ側が変わっていたら、上書きになることを知らせる', () => {
    const { root } = setupWith([saved]);
    paste(root, reply([{ ...ruleSnapshot(saved, false), rev: '00000000', title: '支払（本社）' }]));
    click(root, '内容を確認');
    expect(root.querySelector('.ai-preview-update .issue-warning')?.textContent).toContain('反映すると、その変更は上書きされます');
  });
});
