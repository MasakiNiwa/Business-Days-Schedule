/**
 * エントリポイント。
 *
 * M1 時点ではロジック層（src/core/）とデータ更新パイプラインの構築までが範囲で、
 * カレンダー UI は M2 以降で実装する。ここでは祝日データが正しく配信されているか
 * ——docs/SPEC.md §8.5 の「出典と取得日時の表示」——だけを確認できるようにしている。
 */

import './style.css';
import { createBusinessDayCalendar, createDefaultCalendars } from './core/businessDay';
import { todayInTokyo } from './core/dateUtil';
import { createHolidayLookup, fetchHolidayData } from './core/holidays';
import { resolveStore } from './core/storage';

const HOLIDAYS_URL = `${import.meta.env.BASE_URL}data/holidays.json`;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

function definitionList(entries: [string, string][]): string {
  const rows = entries
    .map(([term, value]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');
  return `<dl>${rows}</dl>`;
}

async function render(root: HTMLElement): Promise<void> {
  const today = todayInTokyo();
  const { available } = resolveStore();

  let holidaySection: string;
  try {
    const data = await fetchHolidayData(HOLIDAYS_URL);
    const holidays = createHolidayLookup(data);
    const [companyDefinition] = createDefaultCalendars();
    if (companyDefinition === undefined) throw new Error('既定カレンダーがありません');
    const calendar = createBusinessDayCalendar(companyDefinition, holidays);

    const reason = calendar.closedReason(today);
    const status =
      reason === null
        ? '営業日'
        : reason.kind === 'weekend'
          ? '休業日（週末）'
          : reason.kind === 'closedDate'
            ? '休業日（臨時休業）'
            : `休業日（${reason.label}）`;

    holidaySection = [
      '<div class="card">',
      '<h2>祝日データ</h2>',
      definitionList([
        ['出典', data.meta.source],
        ['取得日時', data.meta.fetchedAt],
        ['収録範囲', `${data.meta.range.from} 〜 ${data.meta.range.to}`],
        ['件数', `${data.meta.count} 件`],
        ['出典 SHA', data.meta.sourceSha ?? '(記録なし)'],
        ['内閣府CSVとの突合', data.meta.verifiedAgainstCao === true ? '一致' : '未検証'],
      ]),
      '</div>',
      '<div class="card">',
      '<h2>本日（自社カレンダー）</h2>',
      definitionList([
        ['日付', today],
        ['判定', status],
      ]),
      '</div>',
    ].join('');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    holidaySection = `<div class="card error"><h2>祝日データ</h2><p>${escapeHtml(message)}</p></div>`;
  }

  root.innerHTML = [
    '<h1>Business Days Schedule</h1>',
    '<p class="lede">営業日を考慮した反復ルール駆動のカレンダー（開発中）</p>',
    holidaySection,
    '<div class="card">',
    '<h2>状態</h2>',
    definitionList([
      ['マイルストーン', 'M1: ロジック層と祝日データ更新の基盤'],
      ['次の予定', 'M2: 月カレンダー表示と GitHub Pages 公開'],
      ['この端末への保存', available ? '利用可能' : '利用できません（設定は保持されません）'],
    ]),
    '<p><a href="https://github.com/MasakiNiwa/Business-Days-Schedule/blob/main/docs/SPEC.md">仕様書を見る</a></p>',
    '</div>',
  ].join('');
}

const root = document.querySelector<HTMLElement>('#app');
if (root !== null) {
  void render(root);
}
