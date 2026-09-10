/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { renderCalendarExport } from '../src/ui/CalendarExportView';
import type { CalendarExportHandlers } from '../src/ui/CalendarExportView';

const TODAY = '2026-09-05';

function open(
  count = 42,
  options?: Parameters<typeof renderCalendarExport>[2],
): { element: HTMLElement; handlers: CalendarExportHandlers } {
  const handlers: CalendarExportHandlers = {
    onExport: vi.fn(),
    countOccurrences: vi.fn(() => count),
    onClose: vi.fn(),
  };
  return { element: renderCalendarExport(handlers, TODAY, options), handlers };
}

/** 「対象」の選択欄。グループが1つも無いときは出さない。 */
const targetSelect = (root: ParentNode): HTMLSelectElement | null =>
  [...root.querySelectorAll<HTMLSelectElement>('select')].find(
    (node) => node.querySelector('option')?.textContent === 'すべてのグループ',
  ) ?? null;

const clickText = (root: ParentNode, text: string): void => {
  [...root.querySelectorAll('button')]
    .find((b) => b.textContent === text)
    ?.dispatchEvent(new MouseEvent('click'));
};

const dateInputs = (root: ParentNode): HTMLInputElement[] =>
  [...root.querySelectorAll<HTMLInputElement>('input[type="date"]')];

/** グループの選択チップ。 */
const groupChips = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.group-choices .group-chip')].map((n) => n.textContent ?? '');

const pressedChips = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.group-choices .group-chip[aria-pressed="true"]')].map(
    (n) => n.textContent ?? '',
  );

const clickChip = (root: HTMLElement, label: string): void => {
  const chip = [...root.querySelectorAll<HTMLButtonElement>('.group-choices .group-chip')].find(
    (n) => n.textContent === label,
  );
  if (chip === undefined) throw new Error(`チップが見つかりません: ${label}`);
  chip.dispatchEvent(new MouseEvent('click'));
};

describe('renderCalendarExport', () => {
  it('既定は今月の1日から末日、iCalendar', () => {
    // 試しに1回押しただけで1年分が取り込み先へ流れ込まないようにする。
    const { element } = open();
    const [from, to] = dateInputs(element);
    expect(from?.value).toBe('2026-09-01');
    expect(to?.value).toBe('2026-09-30');
    expect(element.querySelector<HTMLSelectElement>('select')?.value).toBe('ics');
  });

  it('取り込み先を分けるよう勧める', () => {
    // 取り込みは取り消しが効かないので、書き出す前に必ず目に入る位置へ置く。
    const { element } = open();
    const callout = element.querySelector('.callout');
    expect(callout?.textContent).toContain('専用のカレンダー');
    expect(callout?.textContent).toContain('Outlook');
    expect(callout?.textContent).toContain('Google カレンダー');
  });

  it('件数を出す', () => {
    const { element } = open(42);
    expect(element.querySelector('.export-summary')?.textContent).toBe(
      '2026-09-01 〜 2026-09-30 の 42 件を書き出します。',
    );
  });

  it('件数が多いときは短い期間から試すよう促す', () => {
    const { element } = open(200);
    expect(element.querySelector('.issue-warning')?.textContent).toContain('短い期間で試す');
  });

  it('該当が無ければ知らせる', () => {
    const { element } = open(0);
    expect(element.querySelector('.issue-warning')?.textContent).toContain('該当する予定がありません');
  });

  it('プリセットは月の区切りで期間を切り替える', () => {
    const { element } = open();
    clickText(element, '3か月');
    const [from, to] = dateInputs(element);
    expect(from?.value).toBe('2026-09-01');
    expect(to?.value).toBe('2026-11-30');
  });

  it('プリセットは今の期間と一致するものを押された状態で示す', () => {
    const { element } = open();
    const pressed = () =>
      [...element.querySelectorAll('.presets button')]
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.textContent);
    expect(pressed()).toEqual(['今月']);
    clickText(element, '来月');
    expect(pressed()).toEqual(['来月']);
  });

  it('開始日が終了日より後なら書き出せない', () => {
    const { element } = open();
    const [, to] = dateInputs(element);
    to!.value = '2026-01-01';
    to?.dispatchEvent(new Event('change'));
    expect(element.querySelector('.issue-error')?.textContent).toContain('開始日が終了日より後');
    const exportButton = [...element.querySelectorAll('button')].find((b) => b.textContent === '書き出す');
    expect(exportButton?.disabled).toBe(true);
  });

  it('書き出しの内容を渡す', () => {
    const { element, handlers } = open();
    element.querySelector<HTMLSelectElement>('select')!.value = 'csv';
    element.querySelector('select')?.dispatchEvent(new Event('change'));
    clickText(element, '書き出す');
    expect(handlers.onExport).toHaveBeenCalledWith({
      from: '2026-09-01',
      to: '2026-09-30',
      format: 'csv',
      includeNotices: true,
      includeFollows: true,
      groups: null,
    });
  });

  it('形式ごとの向き不向きを説明する', () => {
    const { element } = open();
    expect(element.textContent).toContain('迷ったらこちら');
    element.querySelector<HTMLSelectElement>('select')!.value = 'csv';
    element.querySelector('select')?.dispatchEvent(new Event('change'));
    expect(element.textContent).toContain('Outlook.com では CSV の取り込みができない');
  });

  it('準備日とフォローを別々に外せる', () => {
    // 片方だけ要ることがあるので、まとめて1つにしない。
    const boxes = (root: ParentNode): HTMLInputElement[] =>
      [...root.querySelectorAll<HTMLInputElement>('.checkbox input')];

    const first = open();
    const [notice] = boxes(first.element);
    notice!.checked = false;
    notice?.dispatchEvent(new Event('change'));
    clickText(first.element, '書き出す');
    const a = vi.mocked(first.handlers.onExport).mock.calls[0]?.[0];
    expect(a?.includeNotices).toBe(false);
    expect(a?.includeFollows).toBe(true);

    const second = open();
    const [, follow] = boxes(second.element);
    follow!.checked = false;
    follow?.dispatchEvent(new Event('change'));
    clickText(second.element, '書き出す');
    const b = vi.mocked(second.handlers.onExport).mock.calls[0]?.[0];
    expect(b?.includeNotices).toBe(true);
    expect(b?.includeFollows).toBe(false);
  });

  it('日付欄を空にすると書き出せない', () => {
    // 欄が空なのに前の値で書き出せると、画面に出ていない期間を渡してしまう。
    const { element } = open();
    const [from] = dateInputs(element);
    from!.value = '';
    from?.dispatchEvent(new Event('change'));

    expect(element.querySelector('.issue-error')?.textContent).toContain('両方を入力してください');
    const exportButton = [...element.querySelectorAll('button')].find((b) => b.textContent === '書き出す');
    expect(exportButton?.disabled).toBe(true);
    expect(element.querySelector('.export-summary')?.textContent).toBe('');
  });

  it('期間の開始日・終了日に名前が付いている', () => {
    const { element } = open();
    const [from, to] = dateInputs(element);
    expect(from?.getAttribute('aria-label')).toBe('書き出す期間の開始日');
    expect(to?.getAttribute('aria-label')).toBe('書き出す期間の終了日');
  });

  it('閉じるを呼べる', () => {
    const { element, handlers } = open();
    clickText(element, '閉じる');
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  describe('グループ', () => {
    it('グループが無ければ対象の選択欄を出さない', () => {
      const { element } = open();
      expect(targetSelect(element)).toBeNull();
    });

    it('グループと未分類を選べる', () => {
      const { element } = open(42, {
        groups: ['税務', '入金'],
        hasUngrouped: true,
        activeGroups: null,
      });
      expect(groupChips(element)).toEqual(['すべて', '税務', '入金', '未分類']);
    });

    it('未分類のルールが無ければ未分類は出さない', () => {
      const { element } = open(42, { groups: ['税務'], hasUngrouped: false, activeGroups: null });
      expect(groupChips(element)).toEqual(['すべて', '税務']);
    });

    it('画面で絞り込み中のグループを初期値にする', () => {
      // 見ているものと渡すものが食い違うと、画面に無い予定が取り込み先へ紛れ込む。
      const { element, handlers } = open(42, {
        groups: ['税務', '入金'],
        hasUngrouped: false,
        activeGroups: ['税務'],
      });
      expect(pressedChips(element)).toEqual(['税務']);
      clickText(element, '書き出す');
      expect(vi.mocked(handlers.onExport).mock.calls[0]?.[0]?.groups).toEqual(['税務']);
    });

    it('対象を変えると件数を数え直す', () => {
      const { element, handlers } = open(42, {
        groups: ['税務'],
        hasUngrouped: false,
        activeGroups: null,
      });
      clickChip(element, '税務');
      const last = vi.mocked(handlers.countOccurrences).mock.calls.at(-1)?.[0];
      expect(last?.groups).toEqual(['税務']);
    });

    it('複数のグループをまとめて書き出せる', () => {
      // 1つずつしか選べないと、そのたびに書き出し直すことになる。
      const { element, handlers } = open(42, {
        groups: ['税務', '入金'],
        hasUngrouped: false,
        activeGroups: null,
      });
      clickChip(element, '税務');
      clickChip(element, '入金');
      expect(pressedChips(element)).toEqual(['税務', '入金']);
      clickText(element, '書き出す');
      expect(vi.mocked(handlers.onExport).mock.calls[0]?.[0]?.groups).toEqual(['税務', '入金']);
    });

    it('選び直して空になったら「すべて」へ戻す', () => {
      // 何も選ばれていない状態で書き出すと、0件のファイルができてしまう。
      const { element } = open(42, {
        groups: ['税務'],
        hasUngrouped: false,
        activeGroups: ['税務'],
      });
      clickChip(element, '税務');
      expect(pressedChips(element)).toEqual(['すべて']);
    });
  });
});

describe('初期の期間', () => {
  it('渡された期間を初期値にする', () => {
    // 10月を見ているのに 9月が初期値だと、「いま見ている予定を書き出す」つもりの
    // 操作で違う月を渡してしまう。
    const { element } = open(42, {
      groups: [],
      hasUngrouped: false,
      activeGroups: null,
      initialRange: { from: '2026-10-01', to: '2026-10-31' },
    });
    const dates = [...element.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    expect(dates[0]?.value).toBe('2026-10-01');
    expect(dates[1]?.value).toBe('2026-10-31');
  });

  it('渡さなければ今月', () => {
    const { element } = open(42, { groups: [], hasUngrouped: false, activeGroups: null });
    const dates = [...element.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    expect(dates[0]?.value).toBe('2026-09-01');
    expect(dates[1]?.value).toBe('2026-09-30');
  });

  it('その期間で件数を数える', () => {
    const { handlers } = open(42, {
      groups: [],
      hasUngrouped: false,
      activeGroups: null,
      initialRange: { from: '2026-10-01', to: '2026-10-31' },
    });
    const first = vi.mocked(handlers.countOccurrences).mock.calls[0]?.[0];
    expect(first).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
  });
});
