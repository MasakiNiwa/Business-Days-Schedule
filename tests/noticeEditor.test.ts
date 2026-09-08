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

  it('黙って消さず、該当月と理由をプレビューに残す', () => {
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
    const text = form.querySelector('.preview-body')?.textContent ?? '';
    expect(text).toContain('本体より後');
    expect(text).toContain('2026-09-18');
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
    const chain = form.querySelector('.next-dates-chain')?.textContent ?? '';
    expect(chain).toContain('2026-09-10（木）');
    expect(chain).toContain('2026-09-16（水）');
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
      '2026-09-20（日）が休業日のため前営業日へ',
    );
  });
});
