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
  knownGroups: readonly string[] = [],
): { editor: RuleEditor; form: HTMLFormElement; handlers: RuleEditorHandlers } {
  const full: RuleEditorHandlers = {
    onSave: vi.fn(),
    onCancel: vi.fn(),
    onDelete: vi.fn(),
    ...handlers,
  };
  const editor = new RuleEditor(rule, calendars, scheduleContext, full, isNew, TODAY, knownGroups);
  return { editor, form: editor.element, handlers: full };
}

/** 「グループ」欄の入力。datalist と結ばれた自由入力。 */
const groupInput = (form: HTMLFormElement): HTMLInputElement => {
  const input = form.querySelector<HTMLInputElement>('input[list="rule-group-options"]');
  if (input === null) throw new Error('グループ欄が見つかりません');
  return input;
};

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
    // 記号だけでなく「なぜ動いたか」を言葉で添える。
    expect(shifted[0]?.textContent).toContain('2026-10-25（日）が休業日のため前営業日へ');
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

  it('準備日を追加・削除できる', () => {
    const { form, handlers } = open(salary);
    clickText(form, '＋ 準備日を追加（前）');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    const notices = vi.mocked(handlers.onSave).mock.calls[0]?.[0]?.notices ?? [];
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      timing: { kind: 'offset', offset: -3, unit: 'business' },
      role: 'before',
      label: '準備',
    });
    // 追加した時点で固定の id を持つ。順番ではなくこれが外部カレンダーの識別子になる。
    expect(notices[0]?.id).toBeTypeOf('string');
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

describe('グループ', () => {
  it('既存のグループを入力候補として出す', () => {
    // 選択肢だけにすると最初の1つを作れず、自由入力だけだと表記が揺れる。
    const { form } = open(salary, {}, true, ['税務', '入金']);
    const options = [...form.querySelectorAll('#rule-group-options option')].map((node) =>
      node.getAttribute('value'),
    );
    expect(options).toEqual(['税務', '入金']);
    expect(groupInput(form).getAttribute('list')).toBe('rule-group-options');
  });

  it('入力したグループを保存する', () => {
    const onSave = vi.fn();
    const { form } = open(salary, { onSave });
    const input = groupInput(form);
    input.value = '支払';
    input.dispatchEvent(new Event('input'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(vi.mocked(onSave).mock.calls[0]?.[0]?.group).toBe('支払');
  });

  it('設定済みのグループを初期値として出す', () => {
    const { form } = open(makeRule({ ...salary, group: '税務' }));
    expect(groupInput(form).value).toBe('税務');
  });
});

describe('プレビューの前後の予定', () => {
  it('本体だけでなく準備日・フォローも実際の日付で並べる', () => {
    // 本体の日付しか出していなかったため、「3営業日前」と「3営業日後」を
    // 取り違えていても保存前に気づけなかった。
    const rule = makeRule({
      ...salary,
      notices: [
        { offset: -3, unit: 'business', label: '振込データ作成' },
        { offset: 1, unit: 'business', label: '結果の確認' },
      ],
    });
    const { form } = open(rule);

    const first = form.querySelector('.preview-list > li');
    const related = [...(first?.querySelectorAll('.preview-related-item') ?? [])];
    expect(related).toHaveLength(2);

    const text = related.map((node) => node.textContent ?? '');
    expect(text[0]).toContain('↑前');
    expect(text[0]).toContain('振込データ作成');
    expect(text[1]).toContain('↓後');
    expect(text[1]).toContain('結果の確認');
  });

  it('前後の予定は日付順に並ぶ（前 → 本体 → 後）', () => {
    const rule = makeRule({
      ...salary,
      notices: [
        { offset: 1, unit: 'business', label: 'あと' },
        { offset: -3, unit: 'business', label: 'まえ' },
      ],
    });
    const { form } = open(rule);
    const first = form.querySelector('.preview-list > li');
    const dates = [...(first?.querySelectorAll('.preview-related-item .preview-date') ?? [])].map(
      (node) => node.textContent ?? '',
    );
    const mainDate = first?.querySelector('.preview-date')?.textContent ?? '';
    expect(dates).toHaveLength(2);
    expect(dates[0]! < mainDate, `${dates[0]} < ${mainDate}`).toBe(true);
    expect(dates[1]! > mainDate, `${dates[1]} > ${mainDate}`).toBe(true);
  });

  it('前後の予定が無ければ何も足さない', () => {
    const { form } = open(makeRule({ ...salary, notices: [] }));
    expect(form.querySelectorAll('.preview-related')).toHaveLength(0);
  });
});

describe('直近1組の表示', () => {
  it('詳細を開かなくても、準備 → 本体 → フォローが見える', () => {
    // 設定項目だけでは結果が想像しにくく、「次の10回をすべて見る」を
    // 開かないと確かめられないのは遠い。
    const rule = makeRule({
      ...salary,
      notices: [
        { offset: -3, unit: 'business', label: '振込データ作成' },
        { offset: 1, unit: 'business', label: '結果の確認' },
      ],
    });
    const { form } = open(rule);
    const chain = form.querySelector('.next-dates-chain')?.textContent ?? '';

    expect(chain).toContain('振込データ作成');
    expect(chain).toContain('給与振込');
    expect(chain).toContain('結果の確認');
    // 準備 → 本体 → フォローの順であること。
    expect(chain.indexOf('振込データ作成')).toBeLessThan(chain.indexOf('給与振込'));
    expect(chain.indexOf('給与振込')).toBeLessThan(chain.indexOf('結果の確認'));
  });

  it('前後の予定が無ければ本体だけを出す', () => {
    const { form } = open(makeRule({ ...salary, notices: [] }));
    const chain = form.querySelector('.next-dates-chain')?.textContent ?? '';
    expect(chain).toContain('給与振込');
    expect(chain).not.toContain('→');
  });
});

describe('反復の種類を往復したときの休業日補正', () => {
  /**
   * 「第N営業日」は常に営業日なので、補正の設定は効かない。効かない値を
   * 触れる状態で残すと、保存された値と実際の計算が食い違うため none に均す。
   * ただし均したまま戻すと、往復しただけで「前営業日へ」が「補正しない」に
   * 変わる。2026-10 の予定が 23日（金）から 25日（日）へ動いていた。
   */
  const monthly = makeRule({
    id: 'close',
    title: '月次締め',
    calendarId: companyCalendarDef.id,
    recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
    adjust: { mode: 'prev', keepInMonth: false },
  });

  const savedAdjust = (form: HTMLFormElement, handlers: RuleEditorHandlers): Rule['adjust'] => {
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    const saved = vi.mocked(handlers.onSave).mock.calls[0]?.[0];
    if (saved === undefined) throw new Error('保存されませんでした');
    return saved.adjust;
  };

  it('戻したら元の補正が復る', () => {
    const { form, handlers } = open(monthly);
    clickText(form, '第N営業日');
    clickText(form, '毎月N日');
    expect(savedAdjust(form, handlers)).toEqual({ mode: 'prev', keepInMonth: false });
  });

  it('画面の選択も元に戻る', () => {
    const { form } = open(monthly);
    clickText(form, '第N営業日');
    clickText(form, '毎月N日');
    const modeSelect = form.querySelector<HTMLSelectElement>('.adjust-controls select');
    expect(modeSelect?.value).toBe('prev');
  });

  it('プレビューの日付も元に戻る', () => {
    const { form } = open(monthly);
    const before = previewDates(form)[0];
    clickText(form, '第N営業日');
    clickText(form, '毎月N日');
    // 2026-09-25 は金曜。補正が効いていれば動かない。
    expect(previewDates(form)[0]).toBe(before);
  });

  it('効かない種類のあいだは none のまま保存する', () => {
    const { form, handlers } = open(monthly);
    clickText(form, '第N営業日');
    expect(savedAdjust(form, handlers)).toEqual({ mode: 'none', keepInMonth: false });
  });

  it('自分で「補正しない」を選んだなら、往復しても none のまま', () => {
    const { form, handlers } = open(monthly);
    const modeSelect = form.querySelector<HTMLSelectElement>('.adjust-controls select');
    modeSelect!.value = 'none';
    modeSelect!.dispatchEvent(new Event('change'));

    clickText(form, '第N営業日');
    clickText(form, '毎月N日');
    expect(savedAdjust(form, handlers)).toEqual({ mode: 'none', keepInMonth: false });
  });

  it('当月内補正の指定も一緒に戻る', () => {
    const { form, handlers } = open(
      makeRule({ ...monthly, adjust: { mode: 'next', keepInMonth: true } }),
    );
    clickText(form, '第N営業日');
    clickText(form, '毎月N日');
    expect(savedAdjust(form, handlers)).toEqual({ mode: 'next', keepInMonth: true });
  });
});
