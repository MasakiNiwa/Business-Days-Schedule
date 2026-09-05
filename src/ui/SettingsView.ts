/**
 * 設定画面（docs/SPEC.md §8.5）。
 *
 * 営業日カレンダーの編集と、定義データの入出力。
 * 入出力は本来 M4 の範囲だが、ルールを編集できるようになった時点で
 * バックアップ手段が無いのは危ういため M3 で先に入れる。
 */

import { createBusinessDayCalendar } from '../core/businessDay';
import { monthOf, todayInTokyo, yearOf } from '../core/dateUtil';
import type { HolidayLookup } from '../core/holidays';
import { exportFileName } from '../core/storage';
import type { BusinessCalendar, DateStr, Month, Weekday } from '../types';
import { validateCalendar } from '../core/validate';
import { button, checkbox, field, named, select } from './controls';
import { clear, h } from './dom';
import { BUILD_INFO, longVersion } from '../core/buildInfo';

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const;
const MONTH_DAY_PATTERN = /^\d{2}-\d{2}$/;

export type SettingsHandlers = {
  onChange: (calendars: BusinessCalendar[]) => void;
  onExport: () => void;
  onExportCalendar: () => void;
  onImport: (file: File, mode: 'replace' | 'merge') => void;
  onClearAll: () => void;
  onClose: () => void;
};

export class SettingsView {
  readonly element: HTMLElement;

  private calendars: BusinessCalendar[];
  private readonly body = h('div', { class: 'settings-body' });
  private readonly today: DateStr;

  constructor(
    calendars: readonly BusinessCalendar[],
    private readonly holidays: HolidayLookup,
    private readonly handlers: SettingsHandlers,
    today: DateStr = todayInTokyo(),
  ) {
    this.calendars = structuredClone(calendars) as BusinessCalendar[];
    this.today = today;
    this.element = h(
      'section',
      { class: 'settings' },
      h('h2', { class: 'editor-title' }, '設定'),
      this.body,
      h(
        'div',
        { class: 'editor-actions' },
        button('閉じる', () => this.handlers.onClose(), 'button button-primary'),
      ),
    );
    this.render();
  }

  /** 変更を親へ通知し、営業日数の表示も更新する。 */
  private commit(): void {
    this.handlers.onChange(structuredClone(this.calendars));
    this.render();
  }

  private render(): void {
    clear(this.body);
    for (const [index, calendar] of this.calendars.entries()) {
      this.body.append(this.calendarSection(calendar, index));
    }
    this.body.append(this.dataSection(), this.holidaySection(), this.aboutSection());
  }

  private calendarSection(calendar: BusinessCalendar, index: number): HTMLElement {
    const issues = validateCalendar(calendar);
    const businessDays = createBusinessDayCalendar(calendar, this.holidays).businessDaysOfMonth(
      yearOf(this.today),
      monthOf(this.today),
    ).length;

    return h(
      'section',
      { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, calendar.name),
      h(
        'p',
        { class: 'field-hint' },
        `${yearOf(this.today)}年${monthOf(this.today)}月の営業日は ${businessDays} 日です。`,
      ),
      ...issues.map((issue) =>
        h('p', { class: `issue issue-${issue.severity}` }, issue.message),
      ),
      field(
        '週の休業日',
        h(
          'div',
          { class: 'toggles' },
          ...WEEKDAY_NAMES.map((label, weekday) => {
            const isClosed = calendar.weekendDays.includes(weekday as Weekday);
            const toggle = h(
              'button',
              { type: 'button', class: 'toggle', 'aria-pressed': isClosed ? 'true' : 'false' },
              label,
            );
            toggle.addEventListener('click', () => {
              const next = new Set(calendar.weekendDays);
              if (next.has(weekday as Weekday)) next.delete(weekday as Weekday);
              else next.add(weekday as Weekday);
              this.calendars[index] = {
                ...calendar,
                weekendDays: [...next].sort((a, b) => a - b),
              };
              this.commit();
            });
            return toggle;
          }),
        ),
        '土曜出勤なら土を外します。',
      ),
      checkbox('国民の祝日を休業日にする', calendar.useNationalHolidays, (value) => {
        this.calendars[index] = { ...calendar, useNationalHolidays: value };
        this.commit();
      }),
      field(
        '決算月',
        select(
          Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` })),
          String(calendar.fiscalYearEndMonth ?? 3),
          (value) => {
            this.calendars[index] = { ...calendar, fiscalYearEndMonth: Number(value) as Month };
            this.commit();
          },
        ),
        '事業年度の終わる月。「決算月基準」のルール（申告期限・期首・中間申告・四半期など）は、ここを変えるとまとめて追従します。',
      ),
      this.closedRangesField(calendar, index),
      this.dateListField(
        '臨時休業日',
        calendar.closedDates,
        (dates) => {
          this.calendars[index] = { ...calendar, closedDates: dates };
          this.commit();
        },
        '創立記念日など、その年だけの休業日。',
      ),
      this.dateListField(
        '休業日だが営業する日',
        calendar.openDates,
        (dates) => {
          this.calendars[index] = { ...calendar, openDates: dates };
          this.commit();
        },
        'ここに入れた日は、祝日でも週末でも営業日として扱われます（最優先）。',
      ),
    );
  }

  private closedRangesField(calendar: BusinessCalendar, index: number): HTMLElement {
    const list = h('div', { class: 'rows' });

    const update = (ranges: BusinessCalendar['closedRanges']): void => {
      this.calendars[index] = { ...calendar, closedRanges: ranges };
      this.commit();
    };

    for (const [rangeIndex, range] of calendar.closedRanges.entries()) {
      const from = named(
        h('input', { type: 'text', class: 'input input-md', value: range.from, placeholder: 'MM-DD' }),
        `休業期間 ${rangeIndex + 1}: 開始（MM-DD）`,
      );
      const to = named(
        h('input', { type: 'text', class: 'input input-md', value: range.to, placeholder: 'MM-DD' }),
        `休業期間 ${rangeIndex + 1}: 終了（MM-DD）`,
      );
      const label = named(
        h('input', { type: 'text', class: 'input', value: range.label, placeholder: '名称' }),
        `休業期間 ${rangeIndex + 1}: 名称`,
      );

      const apply = (): void => {
        if (!MONTH_DAY_PATTERN.test(from.value) || !MONTH_DAY_PATTERN.test(to.value)) return;
        const next = [...calendar.closedRanges];
        next[rangeIndex] = { from: from.value, to: to.value, label: label.value };
        update(next);
      };
      from.addEventListener('change', apply);
      to.addEventListener('change', apply);
      label.addEventListener('change', apply);

      list.append(
        h(
          'div',
          { class: 'row' },
          from,
          h('span', { class: 'unit' }, '〜'),
          to,
          label,
          button('削除', () => {
            update(calendar.closedRanges.filter((_, i) => i !== rangeIndex));
          }, 'button button-sm button-quiet'),
        ),
      );
    }

    list.append(
      button('＋ 休業期間を追加', () => {
        update([...calendar.closedRanges, { from: '08-13', to: '08-15', label: '夏季休業' }]);
      }, 'button button-sm'),
    );

    return field(
      '毎年の休業期間',
      list,
      '月日で指定します。12-29 〜 01-03 のように年をまたぐ指定もできます。',
    );
  }

  private dateListField(
    label: string,
    dates: readonly DateStr[],
    onChange: (dates: DateStr[]) => void,
    hint: string,
  ): HTMLElement {
    const list = h('ul', { class: 'chips-list' });
    for (const [index, date] of dates.entries()) {
      list.append(
        h(
          'li',
          { class: 'chip-static' },
          date,
          button('×', () => onChange(dates.filter((_, i) => i !== index)), 'chip-remove'),
        ),
      );
    }
    if (dates.length === 0) list.append(h('li', { class: 'field-hint' }, 'なし'));

    const picker = named(h('input', { type: 'date', class: 'input' }), `${label}に追加する日付`);
    return field(
      label,
      h(
        'div',
        {},
        list,
        h(
          'div',
          { class: 'row' },
          picker,
          button('追加', () => {
            if (picker.value === '' || dates.includes(picker.value)) return;
            onChange([...dates, picker.value].sort());
          }, 'button button-sm'),
        ),
      ),
      hint,
    );
  }

  private dataSection(): HTMLElement {
    const fileInput = named(
      h('input', { type: 'file', accept: 'application/json,.json', class: 'input' }),
      '取り込む JSON ファイル',
    );
    const modeSelect = named(h('select', { class: 'select' }), '取り込み方');
    modeSelect.append(
      h('option', { value: 'replace' }, '置き換える'),
      h('option', { value: 'merge' }, 'マージする（ID 重複は取り込み側を採用）'),
    );

    return h(
      'section',
      { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, 'データ'),
      field(
        'エクスポート',
        button(`${exportFileName()} を保存`, () => this.handlers.onExport(), 'button'),
        'ルールとカレンダーを JSON で書き出します。端末の移行やバックアップに使ってください。',
      ),
      field(
        '外部カレンダーへ書き出す',
        button('Google カレンダー / Outlook 用に書き出す', () => this.handlers.onExportCalendar(), 'button'),
        '期間を指定して iCalendar (.ics) または CSV で書き出します。会社指定のカレンダーへ取り込みたいときに使ってください。',
      ),
      field(
        'インポート',
        h(
          'div',
          { class: 'row' },
          fileInput,
          modeSelect,
          button('取り込む', () => {
            const file = fileInput.files?.[0];
            if (file === undefined) return;
            this.handlers.onImport(file, modeSelect.value as 'replace' | 'merge');
          }, 'button'),
        ),
      ),
      field(
        'すべて削除',
        button('この端末の設定をすべて削除', () => this.handlers.onClearAll(), 'button button-danger'),
        'ルール・カレンダー設定をこの端末から消します。取り消せません。',
      ),
    );
  }

  /** 版の情報。不具合の報告時に、どのビルドを見ているかを伝えられるようにする。 */
  private aboutSection(): HTMLElement {
    const rows: [string, string][] = [
      ['アプリ', '営業日スケジュール'],
      ['版', longVersion()],
      ['ビルド日時', BUILD_INFO.builtAt === '' ? '不明' : BUILD_INFO.builtAt],
      ['コミット', BUILD_INFO.commit],
    ];
    return h(
      'section',
      { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, 'このアプリについて'),
      h(
        'dl',
        { class: 'meta-list' },
        ...rows.flatMap(([term, value]) => [h('dt', {}, term), h('dd', {}, value)]),
      ),
    );
  }

  private holidaySection(): HTMLElement {
    const meta = this.holidays.meta;
    const rows: [string, string][] = [
      ['出典', meta.source],
      ['取得日時', meta.fetchedAt],
      ['収録範囲', `${meta.range.from} 〜 ${meta.range.to}`],
      ['件数', `${meta.count} 件`],
      ['出典のバージョン', meta.sourceSha ?? '(記録なし)'],
      [
        '内閣府CSVとの突合',
        meta.verifiedAgainstCao === true
          ? '一致'
          : meta.verifiedAgainstCao === false
            ? '不一致または未取得'
            : '未検証',
      ],
    ];

    return h(
      'section',
      { class: 'editor-section' },
      h('h3', { class: 'editor-heading' }, '祝日データ'),
      h(
        'dl',
        { class: 'meta-list' },
        ...rows.flatMap(([term, value]) => [h('dt', {}, term), h('dd', {}, value)]),
      ),
      h(
        'p',
        { class: 'field-hint' },
        '春分の日・秋分の日は前年2月の官報公示で確定します。それ以前の年の値は暫定です。',
      ),
    );
  }
}
