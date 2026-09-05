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
  it('既定は今日から1年、iCalendar', () => {
    const { element } = open();
    const [from, to] = dateInputs(element);
    expect(from?.value).toBe('2026-09-05');
    expect(to?.value).toBe('2027-09-04');
    expect(element.querySelector<HTMLSelectElement>('select')?.value).toBe('ics');
  });

  it('件数を出す', () => {
    const { element } = open(42);
    expect(element.querySelector('.export-summary')?.textContent).toBe(
      '2026-09-05 〜 2027-09-04 の 42 件を書き出します。',
    );
  });

  it('該当が無ければ知らせる', () => {
    const { element } = open(0);
    expect(element.querySelector('.issue-warning')?.textContent).toContain('該当する予定がありません');
  });

  it('プリセットで期間を切り替えられる', () => {
    const { element } = open();
    clickText(element, '今日から3か月');
    const [from, to] = dateInputs(element);
    expect(from?.value).toBe('2026-09-05');
    expect(to?.value).toBe('2026-12-05');
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
      from: '2026-09-05',
      to: '2027-09-04',
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
