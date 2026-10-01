/**
 * 直近の回の一覧（本体と、紐づく準備日・フォロー）。
 *
 * ルール編集画面の「次の10回」と、AI 設定の取り込み前の確認で同じものを使う。
 * 別々に書くと、同じ設定なのに画面によって見え方が食い違う。
 */

import { weekdayOf } from '../core/dateUtil';
import type { PreviewSeries } from '../core/schedule';
import { h } from './dom';

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const;

const dayLabel = (date: string): string => `${date}（${WEEKDAY_NAMES[weekdayOf(date)] ?? ''}）`;

export function renderPreviewList(series: readonly PreviewSeries[]): HTMLOListElement {
  const list = h('ol', { class: 'preview-list' });
  for (const { main, related, unresolved: missing } of series) {
    const item = h(
      'li',
      { class: main.shifted ? 'is-shifted' : '' },
      h('span', { class: 'preview-date' }, main.date),
      h('span', { class: 'preview-weekday' }, `(${WEEKDAY_NAMES[weekdayOf(main.date)]})`),
      // カレンダー上の ← → と同じ向き記号を使い、読み替えの手間をなくす。
      // 「なぜ動いたか」を言葉で添える。記号だけだと設定と結果が結び付かない。
      main.shifted
        ? h(
            'span',
            { class: `preview-note is-${main.shiftDirection ?? 'prev'}` },
            `${main.shiftDirection === 'prev' ? '←' : '→'} ${dayLabel(main.rawDate)}が休業日のため${
              main.shiftDirection === 'prev' ? '前営業日へ' : '翌営業日へ'
            }`,
          )
        : null,
    );

    // 前後の予定も実際の日付で並べる。本体の日付しか出していなかったため、
    // 「3営業日前」と「3営業日後」を取り違えていても画面で気づけなかった。
    if (related.length > 0 || missing.length > 0) {
      const chain = h('ul', { class: 'preview-related' });
      for (const item2 of related) {
        const row = h(
          'li',
          { class: `preview-related-item is-${item2.kind}` },
          h('span', { class: 'preview-related-mark' }, item2.kind === 'follow' ? '↓後' : '↑前'),
          h('span', { class: 'preview-date' }, dayLabel(item2.date)),
          h('span', { class: 'preview-related-label' }, item2.noticeLabel ?? ''),
        );
        // 「翌週水曜」が木曜に出ていると、設定を間違えたのか休業日で動いたのかが
        // 画面から読み取れない。動いたなら理由を添える。
        if (item2.noticeMovedFrom !== undefined) {
          row.append(
            h('span', { class: 'preview-note' }, `${dayLabel(item2.noticeMovedFrom)}が休業日のため`),
          );
        }
        chain.append(row);
      }
      // 消さずに、その回ごとに「計算できません」と理由を残す。
      for (const { notice, detail } of missing) {
        chain.append(
          h(
            'li',
            { class: 'preview-related-item is-unresolved' },
            h('span', { class: 'preview-related-mark' }, '—'),
            h('span', { class: 'preview-date' }, '計算できません'),
            h('span', { class: 'preview-related-label' }, `${notice.label}: ${detail}`),
          ),
        );
      }
      item.append(chain);
    }
    list.append(item);
  }
  return list;
}
