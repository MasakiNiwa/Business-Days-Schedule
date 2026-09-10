/**
 * @vitest-environment jsdom
 *
 * 前後の予定の編集欄。
 *
 * 見ているのは「入力欄に出ている値と、保存される値が一致すること」。
 * 以前は 0 や空欄をその場で無視して前の値を残していたため、画面には 0 が
 * 出たまま古い値が保存されていた。何が保存されるのか分からなくなる。
 */

import { describe, expect, it, vi } from 'vitest';
import { RuleEditor } from '../src/ui/RuleEditor';
import type { RuleEditorHandlers } from '../src/ui/RuleEditor';
import type { Rule } from '../src/types';
import { companyCalendarDef, bankCalendarDef, makeRule, scheduleContext } from './helpers';

const calendars = [companyCalendarDef, bankCalendarDef];

function open(rule: Rule): { form: HTMLFormElement; handlers: RuleEditorHandlers } {
  const handlers: RuleEditorHandlers = { onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn() };
  const editor = new RuleEditor(rule, calendars, scheduleContext, handlers, false, '2026-09-04', []);
  return { form: editor.element, handlers };
}

/** 新規作成の画面。ひな型の選択欄が出る。 */
function openNew(): { form: HTMLFormElement; handlers: RuleEditorHandlers } {
  const handlers: RuleEditorHandlers = { onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn() };
  const editor = new RuleEditor(
    makeRule({ title: '' }),
    calendars,
    scheduleContext,
    handlers,
    true,
    '2026-09-04',
    [],
  );
  return { form: editor.element, handlers };
}

const at = (form: HTMLFormElement, label: string): HTMLInputElement | HTMLSelectElement => {
  const node = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
  if (node === null) throw new Error(`欄が見つかりません: ${label}`);
  return node;
};

const type = (element: HTMLInputElement | HTMLSelectElement, raw: string): void => {
  element.value = raw;
  element.dispatchEvent(new Event('input'));
};

const choose = (element: HTMLInputElement | HTMLSelectElement, raw: string): void => {
  element.value = raw;
  element.dispatchEvent(new Event('change'));
};

const save = (form: HTMLFormElement, handlers: RuleEditorHandlers): Rule | undefined => {
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  return vi.mocked(handlers.onSave).mock.calls[0]?.[0];
};

const clickText = (root: ParentNode, text: string): void => {
  const target = [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  if (target === undefined) throw new Error(`ボタンが見つかりません: ${text}`);
  target.dispatchEvent(new MouseEvent('click'));
};

const issues = (form: HTMLFormElement): string[] =>
  [...form.querySelectorAll('.issue')].map((node) => node.textContent ?? '');

const monthly = (nth: number): Rule =>
  makeRule({
    id: 'r',
    title: '月次締め',
    notices: [{ id: 'n0', label: 'フォロー', timing: { kind: 'monthlyBusinessDay', months: 1, nth } }],
  });

const byDays = (offset: number): Rule =>
  makeRule({
    id: 'r',
    title: '給与振込',
    notices: [{ id: 'n0', label: '準備', timing: { kind: 'offset', offset, unit: 'business' } }],
  });

describe('入力した値と保存される値が一致する', () => {
  it('営業日数に 0 を入れたら 0 のまま保存を止める', () => {
    // 以前はその場で無視して前の値（第5営業日）を残していた。
    const { form, handlers } = open(monthly(5));
    const input = at(form, '1 件目: 営業日数');
    type(input, '0');

    expect(input.value).toBe('0');
    expect(issues(form).join('\n')).toContain('営業日数');
    expect(save(form, handlers)).toBeUndefined();
  });

  it('営業日数を空にしても前の値に戻らない', () => {
    const { form, handlers } = open(monthly(5));
    type(at(form, '1 件目: 営業日数'), '');
    expect(save(form, handlers)).toBeUndefined();
  });

  it('本体からの日数に 0 を入れたら 1 に直さず保存を止める', () => {
    const { form, handlers } = open(byDays(-3));
    const input = at(form, '1 件目: 本体から何日か');
    type(input, '0');

    expect(input.value).toBe('0');
    expect(save(form, handlers)).toBeUndefined();
  });

  it('直せば保存できる', () => {
    const { form, handlers } = open(monthly(5));
    type(at(form, '1 件目: 営業日数'), '0');
    type(at(form, '1 件目: 営業日数'), '8');

    expect(issues(form)).toEqual([]);
    expect(save(form, handlers)?.notices[0]?.timing).toMatchObject({ nth: 8 });
  });

  it('打っている途中で入力欄から焦点が外れない', () => {
    // 1文字ごとに行を作り直していたため、続きが打てなかった。
    const { form } = open(monthly(5));
    const input = at(form, '1 件目: 営業日数') as HTMLInputElement;
    document.body.append(form);
    input.focus();
    type(input, '1');

    expect(document.activeElement).toBe(input);
    // 作り直していないので、同じ要素がそのまま画面に残っている。
    expect(at(form, '1 件目: 営業日数')).toBe(input);
    form.remove();
  });
});

describe('月末からの指定', () => {
  it('負の数ではなく「月末から」で選べる', () => {
    const { form, handlers } = open(monthly(5));
    choose(at(form, '1 件目: 月初から数えるか月末から数えるか'), 'end');

    expect((at(form, '1 件目: 営業日数') as HTMLInputElement).value).toBe('5');
    expect(save(form, handlers)?.notices[0]?.timing).toMatchObject({ nth: -5 });
  });

  it('月末からの指定を開くと「月末から」が選ばれている', () => {
    const { form } = open(monthly(-1));
    expect(at(form, '1 件目: 月初から数えるか月末から数えるか').value).toBe('end');
    expect((at(form, '1 件目: 営業日数') as HTMLInputElement).value).toBe('1');
  });
});

describe('決め方の切り替え', () => {
  it('切り替えて戻すと、さっき入れた値が残っている', () => {
    const { form } = open(byDays(-3));
    type(at(form, '1 件目: 本体から何日か'), '10');

    choose(at(form, '1 件目: 日付の決め方'), 'weekday');
    choose(at(form, '1 件目: 日付の決め方'), 'offset');

    expect((at(form, '1 件目: 本体から何日か') as HTMLInputElement).value).toBe('10');
  });

  it('週の設定も覚えている', () => {
    const { form } = open(byDays(-3));
    choose(at(form, '1 件目: 日付の決め方'), 'weekday');
    choose(at(form, '1 件目: どの週か'), '2');

    choose(at(form, '1 件目: 日付の決め方'), 'offset');
    choose(at(form, '1 件目: 日付の決め方'), 'weekday');

    expect(at(form, '1 件目: どの週か').value).toBe('2');
  });
});

describe('画面に見えるラベル', () => {
  it('読み上げ用だけでなく、目で見て何の欄か分かる', () => {
    const { form } = open(monthly(5));
    const labels = [...form.querySelectorAll('.notice-item .field-label')].map(
      (node) => node.textContent ?? '',
    );
    expect(labels).toEqual(
      expect.arrayContaining(['予定名', '日付の決め方', 'どの月', '数え方', '営業日']),
    );
  });

  it('決まった内容を文章でも出す', () => {
    const { form } = open(monthly(5));
    expect(form.querySelector('.notice-summary')?.textContent).toBe('→ 本体の翌月の第5営業日');

    choose(at(form, '1 件目: 月初から数えるか月末から数えるか'), 'end');
    type(at(form, '1 件目: 営業日数'), '1');
    expect(form.querySelector('.notice-summary')?.textContent).toBe('→ 本体の翌月の最終営業日');
  });
});

describe('計算できない前後予定', () => {
  /** 銀行カレンダーの10月は営業日が22日しかない。第25営業日は存在しない。 */
  const impossible = makeRule({
    id: 'r',
    title: '月次締め',
    calendarId: 'bank',
    recurrence: { type: 'monthlyByDay', interval: 1, days: [20], overflow: 'clamp' },
    adjust: { mode: 'none', keepInMonth: false },
    notices: [
      { id: 'n0', label: '確定処理', timing: { kind: 'monthlyBusinessDay', months: 1, nth: 25 } },
    ],
  });

  it('黙って消さず、その回ごとに理由を残す', () => {
    const { form } = open(impossible);
    const text = form.querySelector('.preview-body')?.textContent ?? '';
    expect(text).toContain('計算できません');
    expect(text).toContain('確定処理');
    expect(text).toContain('営業日目がありません');
  });

  it('どの月の話かが分かる', () => {
    const { form } = open(impossible);
    // 本体は毎月20日。最初の回の翌月が名指しされる。
    expect(form.querySelector('.preview-body')?.textContent ?? '').toMatch(/\d+年\d+月には/);
  });

  it('折りたたみを開かなくても、保存欄のそばに件数が出る', () => {
    // 畳んだままだと直近プレビューから消えるだけで、気づかず保存できていた。
    const { form } = open(impossible);
    const alerts = form.querySelector('.editor-alerts')?.textContent ?? '';
    expect(alerts).toContain('確定処理');
    expect(alerts).toContain('日付を決められません');
    expect(alerts).toMatch(/\d+ 件の回/);
  });

  it('同じ理由をまとめて数える（何か月ぶんも並べない）', () => {
    const { form } = open(impossible);
    // 10回ぶん探しても、注意書きは1行にまとまる。
    expect(form.querySelectorAll('.editor-alerts .issue')).toHaveLength(1);
  });

  it('内訳へ移動する手がある', () => {
    const { form } = open(impossible);
    const link = [...form.querySelectorAll('.editor-alerts button')].find(
      (node) => node.textContent === '内訳を見る',
    );
    expect(link).toBeDefined();
    link?.dispatchEvent(new MouseEvent('click'));
    expect(form.querySelector<HTMLDetailsElement>('.advanced-options')?.open).toBeDefined();
  });

  it('保存は止めない（設定として不正ではない）', () => {
    const { form, handlers } = open(impossible);
    expect(save(form, handlers)).toBeDefined();
  });
});

describe('前後が逆転したとき', () => {
  it('日付は出したうえで、確かめてほしいと伝える', () => {
    // 本体 2026-09-20(日)。翌週月曜 09-21 は敬老の日で、前営業日へ戻すと
    // 09-18(金) となり本体を追い越す。
    const overtaking = makeRule({
      id: 'r',
      title: '週次報告',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [20], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [
        { id: 'n0', label: '提出', timing: { kind: 'weekday', weeks: 1, weekday: 1, onClosed: 'prev' } },
      ],
    });
    const { form } = open(overtaking);
    // 折りたたみの外、保存欄のそばに出す。
    const alerts = form.querySelector('.editor-alerts')?.textContent ?? '';
    expect(alerts).toContain('本体より後');
    expect(alerts).toContain('2026-09-18');
    // 日付そのものはプレビューに並ぶ（消さない）。
    expect(form.querySelector('.preview-body')?.textContent ?? '').toContain('2026-09-18');
  });
});

describe('直近1組', () => {
  it('曜日まで出す', () => {
    // 「翌週水曜」のような設定は、日付だけでは合っているか確かめられない。
    const rule = makeRule({
      id: 'r',
      title: '月次締め',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [
        { id: 'n0', label: '報告会', timing: { kind: 'weekday', weeks: 1, weekday: 3, onClosed: 'next' } },
      ],
    });
    const { form } = open(rule);
    // 年は見出し側に1度だけ。日付を並べると年が繰り返されるだけで読みにくい。
    expect(form.querySelector('.next-dates-label')?.textContent).toBe('直近（2026年）:');
    const chain = form.querySelector('.next-dates-chain')?.textContent ?? '';
    expect(chain).toContain('9/10（木）');
    expect(chain).toContain('9/16（水）');
  });

  it('動いた回には理由を添える', () => {
    const shifted = makeRule({
      id: 'r',
      title: '給与振込',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [20], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
    });
    const { form } = open(shifted);
    // 2026-09-20 は日曜。前営業日は 09-18(金)。
    expect(form.querySelector('.next-dates-note')?.textContent).toBe(
      '9/20（日）が休業日のため前営業日へ',
    );
  });
});

describe('打ち直しても向きが変わらない', () => {
  /**
   * 欄を空にすると値は 0 になり、負を保つつもりで -0 を書き戻すことになる。
   * JavaScript では `-0 < 0` が false なので、符号で向きを覚えていると
   * 次の1文字で「前」が黙って「後」に変わってしまっていた。
   */
  it('日数を打ち直しても「前」のまま', () => {
    const { form, handlers } = open(byDays(-3));
    const days = at(form, '1 件目: 本体から何日か');
    type(days, '');
    type(days, '1');
    type(days, '12');

    expect(at(form, '1 件目: 本体の前か後か').value).toBe('before');
    expect(form.querySelector('.notice-summary')?.textContent).toBe('→ 本体の12営業日前');
    expect(save(form, handlers)?.notices[0]?.timing).toMatchObject({ offset: -12 });
  });

  it('営業日数を打ち直しても「月末から」のまま', () => {
    const { form, handlers } = open(monthly(-3));
    const days = at(form, '1 件目: 営業日数');
    type(days, '');
    type(days, '2');

    expect(at(form, '1 件目: 月初から数えるか月末から数えるか').value).toBe('end');
    expect(save(form, handlers)?.notices[0]?.timing).toMatchObject({ nth: -2 });
  });

  it('向きを変えたあとに打ち直しても、変えた向きのまま', () => {
    const { form, handlers } = open(byDays(-3));
    choose(at(form, '1 件目: 本体の前か後か'), 'after');
    const days = at(form, '1 件目: 本体から何日か');
    type(days, '');
    type(days, '7');

    expect(save(form, handlers)?.notices[0]?.timing).toMatchObject({ offset: 7 });
  });
});

describe('編集途中の状態が勝手に変わらない', () => {
  /**
   * どれも根は同じで、「大きさ」と「向き」を符号ひとつに畳んで持っていたこと。
   * 畳むと情報が落ちる（`-0 < 0` は false、`-(-3)` は 3）。
   */

  it('決め方を切り替えて戻しても、開いたときの値のまま', () => {
    // 編集開始時の値を登録していなかったため、往復すると既定値へ落ちていた。
    // 「10暦日前」が「3営業日前」になっていた。
    const rule = makeRule({
      id: 'r',
      title: 'x',
      notices: [{ id: 'n0', label: '準備', timing: { kind: 'offset', offset: -10, unit: 'calendar' } }],
    });
    const { form, handlers } = open(rule);
    choose(at(form, '1 件目: 日付の決め方'), 'weekday');
    choose(at(form, '1 件目: 日付の決め方'), 'offset');

    expect((at(form, '1 件目: 本体から何日か') as HTMLInputElement).value).toBe('10');
    expect(at(form, '1 件目: 単位').value).toBe('calendar');
    expect(at(form, '1 件目: 本体の前か後か').value).toBe('before');
    expect(save(form, handlers)?.notices[0]?.timing).toEqual({
      kind: 'offset',
      offset: -10,
      unit: 'calendar',
    });
  });

  it('月と第N営業日でも、切り替えて戻せば元の値', () => {
    const { form } = open(monthly(-2));
    choose(at(form, '1 件目: 日付の決め方'), 'offset');
    choose(at(form, '1 件目: 日付の決め方'), 'monthlyBusinessDay');

    expect(at(form, '1 件目: 月初から数えるか月末から数えるか').value).toBe('end');
    expect((at(form, '1 件目: 営業日数') as HTMLInputElement).value).toBe('2');
  });

  it('負の日数を入れても「前」のまま。後ろの日付にはならない', () => {
    // 符号を付けた結果が +3 になり、画面は「前」なのに「3営業日後」で
    // 保存できてしまっていた。
    const { form, handlers } = open(byDays(-3));
    type(at(form, '1 件目: 本体から何日か'), '-3');

    expect(at(form, '1 件目: 本体の前か後か').value).toBe('before');
    expect(issues(form).join('\n')).toContain('1 以上の整数');
    expect(save(form, handlers)).toBeUndefined();
  });

  it('負の営業日数でも「月初から」が裏返らない', () => {
    const { form, handlers } = open(monthly(5));
    type(at(form, '1 件目: 営業日数'), '-5');

    expect(at(form, '1 件目: 月初から数えるか月末から数えるか').value).toBe('start');
    expect(save(form, handlers)).toBeUndefined();
  });

  it('空欄のまま別の予定を追加しても、向きが入れ替わらない', () => {
    // 向きを覚えている変数が、欄の作り直しで初期化されていた。
    const { form, handlers } = open(byDays(-3));
    type(at(form, '1 件目: 本体から何日か'), '');
    clickText(form, '＋ フォローを追加（後）');
    type(at(form, '1 件目: 本体から何日か'), '3');

    expect(at(form, '1 件目: 本体の前か後か').value).toBe('before');
    expect(save(form, handlers)?.notices[0]?.timing).toMatchObject({ offset: -3 });
  });

  it('空欄のまま1件目を消しても、2件目の向きが残る', () => {
    const rule = makeRule({
      id: 'r',
      title: 'x',
      notices: [
        { id: 'n0', label: '準備', timing: { kind: 'offset', offset: -3, unit: 'business' } },
        { id: 'n1', label: '確認', timing: { kind: 'offset', offset: 5, unit: 'business' } },
      ],
    });
    const { form, handlers } = open(rule);
    type(at(form, '2 件目: 本体から何日か'), '');
    clickText(form, '削除');
    type(at(form, '1 件目: 本体から何日か'), '5');

    expect(at(form, '1 件目: 本体の前か後か').value).toBe('after');
    expect(save(form, handlers)?.notices[0]?.timing).toMatchObject({ offset: 5 });
  });
});

describe('エラーの出し場所', () => {
  it('その予定の欄の直下に出す', () => {
    const { form } = open(monthly(5));
    type(at(form, '1 件目: 営業日数'), '0');
    expect(form.querySelector('.notice-item .notice-issues')?.textContent).toContain(
      '1 以上の整数',
    );
  });

  it('保存欄側では「何件目か」を示す', () => {
    const { form } = open(monthly(5));
    type(at(form, '1 件目: 営業日数'), '0');
    expect(issues(form).join('\n')).toContain('前後の予定 1 件目');
  });

  it('保存しようとすると、その欄へ移動する', () => {
    const rule = makeRule({
      id: 'r',
      title: 'x',
      notices: [
        { id: 'n0', label: '準備', timing: { kind: 'offset', offset: -3, unit: 'business' } },
        { id: 'n1', label: '確認', timing: { kind: 'monthlyBusinessDay', months: 1, nth: 5 } },
      ],
    });
    const { form } = open(rule);
    document.body.append(form);
    type(at(form, '2 件目: 営業日数'), '0');
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    // 行の先頭（どの月）ではなく、悪い値が入っている欄そのものへ運ぶ。
    expect(document.activeElement).toBe(at(form, '2 件目: 営業日数'));
    form.remove();
  });
});

describe('動いた理由を添える', () => {
  it('前後の予定が休業日で動いたら、その理由を出す', () => {
    // 「翌週水曜」が木曜に出ていると、設定を間違えたのか休業日で動いたのかが
    // 画面から読み取れない。
    const rule = makeRule({
      id: 'r',
      title: '月次報告',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [16], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [
        { id: 'n0', label: '報告会', timing: { kind: 'weekday', weeks: 1, weekday: 3, onClosed: 'next' } },
      ],
    });
    const { form } = open(rule);
    // 本体 2026-09-16(水) の翌週水曜は 09-23（秋分の日）。翌営業日 09-24(木) へ。
    const text = form.querySelector('.preview-body')?.textContent ?? '';
    expect(text).toContain('2026-09-24（木）');
    expect(text).toContain('2026-09-23（水）が休業日のため');
  });

  it('動いていない回には理由を付けない', () => {
    const rule = makeRule({
      id: 'r',
      title: '月次報告',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [
        { id: 'n0', label: '報告会', timing: { kind: 'weekday', weeks: 1, weekday: 3, onClosed: 'next' } },
      ],
    });
    const { form } = open(rule);
    const first = form.querySelector('.preview-related-item');
    expect(first?.textContent).toContain('2026-09-16（水）');
    expect(first?.querySelector('.preview-note')).toBeNull();
  });
});

describe('開いて保存するだけでは何も変えない', () => {
  /**
   * 「同じ週」「同じ月」は設定が向きを言わない。それなのに保存時に役割を
   * 一律「後」で塗り替えていたため、既存の準備予定が開いて保存するだけで
   * フォローに変わり、外部カレンダーの識別子まで変わっていた。
   */
  const sameWeekPrep = (): Rule =>
    makeRule({
      id: 'r',
      title: '月次締め',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [11], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [
        {
          id: 'n0',
          label: '打合せ',
          role: 'before',
          timing: { kind: 'weekday', weeks: 0, weekday: 3, onClosed: 'none' },
        },
      ],
    });

  it('同じ週の準備予定は、保存しても準備のまま', () => {
    const { form, handlers } = open(sameWeekPrep());
    expect(save(form, handlers)?.notices[0]?.role).toBe('before');
  });

  it('同じ月の準備予定も、保存しても準備のまま', () => {
    const rule = makeRule({
      id: 'r',
      title: 'x',
      notices: [
        {
          id: 'n0',
          label: '確認',
          role: 'before',
          timing: { kind: 'monthlyBusinessDay', months: 0, nth: 5 },
        },
      ],
    });
    const { form, handlers } = open(rule);
    expect(save(form, handlers)?.notices[0]?.role).toBe('before');
  });

  it('日付の設定も何も変わらない', () => {
    const before = sameWeekPrep();
    const { form, handlers } = open(before);
    const after = save(form, handlers);
    expect(after?.notices).toEqual(before.notices);
  });

  it('ずらす数を変えれば、設定どおりの向きになる', () => {
    // 0 でなくなれば設定から決まるので、そちらが優先される。
    const { form, handlers } = open(sameWeekPrep());
    choose(at(form, '1 件目: どの週か'), '1');
    expect(save(form, handlers)?.notices[0]?.role).toBe('after');
  });
});

describe('ひな型を選び直しても画面が二重にならない', () => {
  it('プレビューの見出しは1つだけ', () => {
    const { form } = openNew();
    clickText(form, '給与');
    const headings = [...form.querySelectorAll('summary')].filter((node) =>
      (node.textContent ?? '').includes('10回'),
    );
    expect(headings).toHaveLength(1);
  });

  it('続けて選び直しても増えない', () => {
    const { form } = openNew();
    clickText(form, '給与');
    // ひな型の欄は選んだあと消えるので、プレビューだけを数える。
    expect(form.querySelectorAll('.preview-body')).toHaveLength(1);
  });
});

describe('年をまたぐ直近1組', () => {
  it('本体と違う年の予定には年を付ける', () => {
    // 「12/31（木） 年末締め → 1/8（金） 翌月確認」だと、翌年の1月8日が
    // 同じ年に見えてしまう。年末年始の前後予定では年が曖昧になる。
    const yearEnd = makeRule({
      id: 'r',
      title: '年末締め',
      recurrence: { type: 'monthlyByDay', interval: 1, days: ['last'], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      period: { start: '2026-12-01', end: null },
      notices: [
        { id: 'n0', label: '翌月確認', timing: { kind: 'monthlyBusinessDay', months: 1, nth: 5 } },
      ],
    });
    const { form } = open(yearEnd);
    const chain = form.querySelector('.next-dates-chain')?.textContent ?? '';

    expect(form.querySelector('.next-dates-label')?.textContent).toBe('直近（2026年）:');
    // 本体は年を出さず、翌年へ回るフォローだけ年を付ける。
    expect(chain).toContain('12/31（木） 年末締め');
    expect(chain).toContain('2027/1/');
  });

  it('同じ年のうちは短いまま', () => {
    const rule = makeRule({
      id: 'r',
      title: '月次締め',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [
        { id: 'n0', label: '報告会', timing: { kind: 'weekday', weeks: 1, weekday: 3, onClosed: 'next' } },
      ],
    });
    const chain = open(rule).form.querySelector('.next-dates-chain')?.textContent ?? '';
    expect(chain).toContain('9/16（水）');
    expect(chain).not.toContain('2026/9/16');
  });
});
