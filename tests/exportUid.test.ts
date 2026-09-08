/**
 * 外部カレンダーの識別子（UID）の安定性 — docs/SPEC.md §9.4。
 *
 * UID は取り込み先で「同じ予定かどうか」の判定に使われる。書き出す期間や
 * 出力順で割り当てが変わると、別の予定を上書きしてしまう。
 */

import { describe, expect, it } from 'vitest';
import { buildIcs } from '../src/core/exportCalendar';
import { expandRules } from '../src/core/schedule';
import { makeRule, scheduleContext } from './helpers';
import type { Rule } from '../src/types';

const OPTIONS = { includeNotices: true, calendarName: 'x' };
const NOW = new Date('2026-01-01T00:00:00Z');

/** 期間を書き出して「日付 → UID」を返す。 */
function uidsByDate(rule: Rule, start: string, end: string): Map<string, string> {
  const occurrences = expandRules([rule], { start, end }, scheduleContext).occurrences;
  const ics = buildIcs(occurrences, new Map([[rule.id, rule]]), OPTIONS, NOW);
  const lines = ics.split('\r\n');
  const map = new Map<string, string>();
  let uid = '';
  for (const line of lines) {
    if (line.startsWith('UID:')) uid = line.slice(4);
    if (line.startsWith('DTSTART;VALUE=DATE:')) {
      // ICS は "20260130"。以降の扱いのため "2026-01-30" へ戻す。
      const basic = line.slice(19);
      map.set(`${basic.slice(0, 4)}-${basic.slice(4, 6)}-${basic.slice(6, 8)}`, uid);
    }
  }
  return map;
}

/** 両側補正＋翌営業日フォロー。1つの基準日から前倒し側と後ろ倒し側の2系列が出る。 */
const bothWithFollow = makeRule({
  id: 'ar',
  title: '入金予定日',
  calendarId: 'bank',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [1], overflow: 'clamp' },
  adjust: { mode: 'both', keepInMonth: false },
  notices: [{ offset: 1, unit: 'business', label: '入金の確認' }],
});

describe('UID は書き出す期間に依存しない', () => {
  it('狭い期間で書き出しても、広い期間と同じ日付に同じ UID が付く', () => {
    // 2026-02-01 は日曜。前倒し 01-30(金)、後ろ倒し 02-02(月)。
    // それぞれの翌営業日フォローが 02-02 と 02-03 に出る。
    const wide = uidsByDate(bothWithFollow, '2026-01-25', '2026-02-10');
    for (const [date, uid] of wide) {
      const narrow = uidsByDate(bothWithFollow, date, date);
      expect(narrow.get(date), `${date} を単独で書き出したとき`).toBe(uid);
    }
  });

  it('両側補正の子予定に、別々の UID が付く', () => {
    // 見分けられないと、狭い期間の書き出しで別の日の予定を上書きしてしまう。
    const wide = uidsByDate(bothWithFollow, '2026-01-25', '2026-02-10');
    const uids = [...wide.values()];
    expect(new Set(uids).size, uids.join('\n')).toBe(uids.length);
  });

  it('連番による後付けの区別に頼っていない', () => {
    // "-1" が付くのは、本来別物であるはずのものが衝突したしるし。
    const wide = uidsByDate(bothWithFollow, '2026-01-25', '2026-02-10');
    for (const uid of wide.values()) {
      expect(uid, uid).not.toMatch(/-\d+@/);
    }
  });

  it('補正が両側でなければ、向きは UID に入らない', () => {
    // 祝日データの更新で補正の有無が変わっても、同じ予定でいられるようにする。
    const oneSided = makeRule({
      ...bothWithFollow,
      id: 'one',
      adjust: { mode: 'prev', keepInMonth: false },
    });
    const uids = [...uidsByDate(oneSided, '2026-01-25', '2026-02-10').values()];
    for (const uid of uids) {
      expect(uid, uid).toContain('-single');
      expect(uid, uid).not.toContain('-prev');
      expect(uid, uid).not.toContain('-next');
    }
  });
});

describe('前後の予定を消しても、残ったものの UID が変わらない', () => {
  /** レビューの再現手順: 1営業日後「着金確認」と3営業日後「消込確認」。 */
  const withBoth = makeRule({
    id: 'ar2',
    title: '請求',
    recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
    adjust: { mode: 'none', keepInMonth: false },
    notices: [
      { id: 'n0', offset: 1, unit: 'business', label: '着金確認' },
      { id: 'n1', offset: 3, unit: 'business', label: '消込確認' },
    ],
  });

  it('先頭を消しても、残ったものは自分の UID を保つ', () => {
    // 順番を使っていたため、消込確認が着金確認の UID を引き継いでいた。
    const before = uidsByDate(withBoth, '2026-09-01', '2026-09-30');
    const afterDelete = makeRule({ ...withBoth, notices: [withBoth.notices[1]!] });
    const after = uidsByDate(afterDelete, '2026-09-01', '2026-09-30');

    // 消込確認が出る日（3営業日後）の UID が変わっていないこと。
    for (const [date, uid] of after) {
      expect(before.get(date), `${date}`).toBe(uid);
    }
    // 消した着金確認の UID を、誰も引き継いでいないこと。
    const removed = [...before.entries()].find(([date]) => !after.has(date))?.[1];
    expect(removed).toBeDefined();
    expect([...after.values()]).not.toContain(removed);
  });

  it('並べ替えても UID が入れ替わらない', () => {
    const reordered = makeRule({
      ...withBoth,
      notices: [withBoth.notices[1]!, withBoth.notices[0]!],
    });
    const before = uidsByDate(withBoth, '2026-09-01', '2026-09-30');
    const after = uidsByDate(reordered, '2026-09-01', '2026-09-30');
    expect([...after.entries()].sort()).toEqual([...before.entries()].sort());
  });

  it('id を持たない古いデータは、今の順番から引き継いで UID を変えない', () => {
    // 移行の時点で既存の書き出しと食い違わせない。
    const legacy = makeRule({
      ...withBoth,
      id: 'legacy',
      notices: [
        { offset: 1, unit: 'business', label: '着金確認' },
        { offset: 3, unit: 'business', label: '消込確認' },
      ],
    });
    const uids = [...uidsByDate(legacy, '2026-09-01', '2026-09-30').values()];
    expect(uids.some((uid) => uid.includes('-n0@'))).toBe(true);
    expect(uids.some((uid) => uid.includes('-n1@'))).toBe(true);
  });
});
