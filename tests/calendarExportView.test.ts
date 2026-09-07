/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { renderCalendarExport } from '../src/ui/CalendarExportView';
import type { CalendarExportHandlers } from '../src/ui/CalendarExportView';

const TODAY = '2026-09-05';

function open(count = 42): { element: HTMLElement; handlers: CalendarExportHandlers } {
  const handlers: CalendarExportHandlers = {
    onExport: vi.fn(),
    countOccurrences: vi.fn(() => count),
    onClose: vi.fn(),
  };
  return { element: renderCalendarExport(handlers, TODAY), handlers };
}

const clickText = (root: ParentNode, text: string): void => {
  [...root.querySelectorAll('button')]
    .find((b) => b.textContent === text)
    ?.dispatchEvent(new MouseEvent('click'));
};

const dateInputs = (root: ParentNode): HTMLInputElement[] =>
  [...root.querySelectorAll<HTMLInputElement>('input[type="date"]')];

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
    });
  });

  it('形式ごとの向き不向きを説明する', () => {
    const { element } = open();
    expect(element.textContent).toContain('迷ったらこちら');
    element.querySelector<HTMLSelectElement>('select')!.value = 'csv';
    element.querySelector('select')?.dispatchEvent(new Event('change'));
    expect(element.textContent).toContain('Outlook.com では CSV の取り込みができない');
  });

  it('事前通知を外せる', () => {
    const { element, handlers } = open();
    const checkbox = element.querySelector<HTMLInputElement>('.checkbox input');
    checkbox!.checked = false;
    checkbox?.dispatchEvent(new Event('change'));
    clickText(element, '書き出す');
    expect(vi.mocked(handlers.onExport).mock.calls[0]?.[0]?.includeNotices).toBe(false);
  });

  it('閉じるを呼べる', () => {
    const { element, handlers } = open();
    clickText(element, '閉じる');
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });
});
