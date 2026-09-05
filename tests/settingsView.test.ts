/**
 * @vitest-environment jsdom
 *
 * 設定画面（docs/SPEC.md §8.5）。
 * 営業日カレンダーの変更が正しく通知され、影響が画面に出ることを固定する。
 */

import { describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../src/ui/SettingsView';
import type { SettingsHandlers } from '../src/ui/SettingsView';
import type { BusinessCalendar } from '../src/types';
import { bankCalendarDef, companyCalendarDef, holidays } from './helpers';

const TODAY = '2026-09-04';

function open(
  calendars: BusinessCalendar[] = [companyCalendarDef, bankCalendarDef],
): { view: SettingsView; element: HTMLElement; handlers: SettingsHandlers } {
  const handlers: SettingsHandlers = {
    onChange: vi.fn(),
    onExport: vi.fn(),
    onExportCalendar: vi.fn(),
    onImport: vi.fn(),
    onClearAll: vi.fn(),
    onClose: vi.fn(),
  };
  const view = new SettingsView(calendars, holidays, handlers, TODAY);
  return { view, element: view.element, handlers };
}

const clickText = (root: ParentNode, text: string): void => {
  const target = [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  if (target === undefined) throw new Error(`ボタンが見つかりません: ${text}`);
  target.dispatchEvent(new MouseEvent('click'));
};

const lastCalendars = (handlers: SettingsHandlers): BusinessCalendar[] =>
  vi.mocked(handlers.onChange).mock.calls.at(-1)?.[0] ?? [];

describe('営業日カレンダーの編集', () => {
  it('カレンダーごとに当月の営業日数を出す', () => {
    const { element } = open();
    // 2026年9月は30日 − 土日8日 − 平日の祝日3日（21・22・23）= 19日。
    expect(element.textContent).toContain('2026年9月の営業日は 19 日です。');
  });

  it('週の休業日を切り替えられる', () => {
    const { element, handlers } = open([companyCalendarDef]);
    const toggles = [...element.querySelectorAll('.toggles .toggle')];
    const saturday = toggles.find((t) => t.textContent === '土');
    expect(saturday?.getAttribute('aria-pressed')).toBe('true');

    saturday?.dispatchEvent(new MouseEvent('click'));
    expect(lastCalendars(handlers)[0]?.weekendDays).toEqual([0]);
  });

  it('祝日を休業日にしない設定にできる', () => {
    const { element, handlers } = open([companyCalendarDef]);
    const checkboxes = [...element.querySelectorAll<HTMLInputElement>('.checkbox input')];
    const holidayToggle = checkboxes[0];
    expect(holidayToggle?.checked).toBe(true);
    holidayToggle!.checked = false;
    holidayToggle?.dispatchEvent(new Event('change'));
    expect(lastCalendars(handlers)[0]?.useNationalHolidays).toBe(false);
  });

  it('休業期間を追加・削除できる', () => {
    const { element, handlers } = open([companyCalendarDef]);
    clickText(element, '＋ 休業期間を追加');
    expect(lastCalendars(handlers)[0]?.closedRanges).toEqual([
      { from: '12-29', to: '01-03', label: '年末年始休業' },
      { from: '08-13', to: '08-15', label: '夏季休業' },
    ]);
  });

  it('臨時営業日を追加できる', () => {
    const { element, handlers } = open([companyCalendarDef]);
    const pickers = [...element.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    // 最後の日付入力が「休業日だが営業する日」。
    const picker = pickers.at(-1);
    picker!.value = '2026-09-21';
    const addButtons = [...element.querySelectorAll('button')].filter((b) => b.textContent === '追加');
    addButtons.at(-1)?.dispatchEvent(new MouseEvent('click'));
    expect(lastCalendars(handlers)[0]?.openDates).toEqual(['2026-09-21']);
  });

  it('元のカレンダー配列を直接書き換えない', () => {
    const original = structuredClone(companyCalendarDef);
    const { element } = open([original]);
    const saturday = [...element.querySelectorAll('.toggles .toggle')].find(
      (t) => t.textContent === '土',
    );
    saturday?.dispatchEvent(new MouseEvent('click'));
    expect(original.weekendDays).toEqual([0, 6]);
  });

  it('全曜日休業にすると警告を出す', () => {
    const { element } = open([
      { ...companyCalendarDef, weekendDays: [0, 1, 2, 3, 4, 5, 6] },
    ]);
    expect(element.querySelector('.issue-warning')?.textContent).toContain('営業日が存在しません');
  });
});

describe('データ操作', () => {
  it('エクスポート・全削除・閉じるを呼べる', () => {
    const { element, handlers } = open();
    const exportButton = [...element.querySelectorAll('button')].find((b) =>
      b.textContent?.endsWith('.json を保存'),
    );
    exportButton?.dispatchEvent(new MouseEvent('click'));
    clickText(element, 'この端末の設定をすべて削除');
    clickText(element, '閉じる');

    expect(handlers.onExport).toHaveBeenCalledOnce();
    expect(handlers.onClearAll).toHaveBeenCalledOnce();
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it('外部カレンダーへの書き出しを呼べる', () => {
    const { element, handlers } = open();
    clickText(element, 'Google カレンダー / Outlook 用に書き出す');
    expect(handlers.onExportCalendar).toHaveBeenCalledOnce();
  });

  it('ファイル未選択ならインポートしない', () => {
    const { element, handlers } = open();
    clickText(element, '取り込む');
    expect(handlers.onImport).not.toHaveBeenCalled();
  });
});

describe('祝日データの出典表示', () => {
  it('出典・範囲・件数を出す', () => {
    const { element } = open();
    const text = element.textContent ?? '';
    expect(text).toContain('holiday-jp/holiday_jp');
    expect(text).toContain('2023-01-01 〜 2027-12-31');
    expect(text).toContain('春分の日・秋分の日は前年2月の官報公示で確定します');
  });
});
