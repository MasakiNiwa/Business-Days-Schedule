/**
 * 外部カレンダーの識別子（UID）の安定性 — docs/SPEC.md §9.4。
 *
 * UID は取り込み先で「同じ予定かどうか」の判定に使われる。書き出す期間や
 * 出力順で割り当てが変わると、別の予定を上書きしてしまう。
 */

import { describe, expect, it } from 'vitest';
import { buildIcs } from '../src/core/exportCalendar';
import { expandRules } from '../src/core/schedule';
import { makeCalendar, makeRule, scheduleContext } from './helpers';
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

describe('前後が入れ替わっても UID が変わらない', () => {
  /**
   * 「翌週の月曜、休業日なら前営業日へ」。月曜を休業日にすると、
   * 前営業日へ戻った結果が本体を追い越し、フォローから準備日へ変わる。
   * 実際の日付から前後を決めて UID に入れていたため、同じ予定の識別子が
   * 変わっていた。取り込み先では別の予定として増える。
   */
  const weekly = (openDates: string[]): { rule: Rule; ctx: typeof scheduleContext } => {
    const rule = makeRule({
      id: 'wk',
      title: '週次報告',
      calendarId: 'flex',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [20], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [
        { id: 'n0', label: '提出', timing: { kind: 'weekday', weeks: 1, weekday: 1, onClosed: 'prev' } },
      ],
    });
    const ctx = {
      ...scheduleContext,
      calendars: new Map(scheduleContext.calendars).set(
        'flex',
        makeCalendar({ id: 'flex', openDates }),
      ),
      fallbackCalendarId: 'flex',
    };
    return { rule, ctx };
  };

  const uidOfRelated = (openDates: string[]): { uid: string; date: string } => {
    const { rule, ctx } = weekly(openDates);
    const occurrences = expandRules([rule], { start: '2026-09-01', end: '2026-09-30' }, ctx)
      .occurrences.filter((o) => o.kind !== 'main');
    const ics = buildIcs(occurrences, new Map([[rule.id, rule]]), OPTIONS, NOW);
    const uid = ics.split('\r\n').find((line) => line.startsWith('UID:'))?.slice(4) ?? '';
    return { uid, date: occurrences[0]?.date ?? '' };
  };

  it('休業日の設定で前後が入れ替わっても、同じ予定として扱われる', () => {
    // 2026-09-21（敬老の日）を営業日にすると 09-21。本体 09-20 より後 = フォロー。
    const open = uidOfRelated(['2026-09-21']);
    // 休業日のままなら前営業日 09-18 へ戻り、本体より前 = 準備日になる。
    const closed = uidOfRelated([]);

    expect(open.date).toBe('2026-09-21');
    expect(closed.date).toBe('2026-09-18');
    expect(closed.uid).toBe(open.uid);
  });

  it('日数指定の UID はこれまでと同じ形のまま', () => {
    // 既に書き出したぶんと食い違わせない。負の offset は notice、正は follow。
    const rule = makeRule({
      id: 'r',
      title: '給与振込',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [
        { id: 'n0', label: '準備', timing: { kind: 'offset', offset: -3, unit: 'business' } },
        { id: 'n1', label: '確認', timing: { kind: 'offset', offset: 3, unit: 'business' } },
      ],
    });
    const occurrences = expandRules([rule], { start: '2026-09-01', end: '2026-09-30' }, scheduleContext)
      .occurrences.filter((o) => o.kind !== 'main');
    const ics = buildIcs(occurrences, new Map([[rule.id, rule]]), OPTIONS, NOW);
    const uids = ics.split('\r\n').filter((line) => line.startsWith('UID:'));

    expect(uids).toContain('UID:r-notice-2026-09-10-single-n0@business-days-schedule');
    expect(uids).toContain('UID:r-follow-2026-09-10-single-n1@business-days-schedule');
  });
});

describe('設定を変えずに保存しても UID が変わらない', () => {
  it('同じ週の準備予定を開いて保存しただけでは、識別子が動かない', () => {
    // 保存時に役割を一律「後」で塗り替えていたため、日付の設定を触っていないのに
    // notice → follow へ変わり、取り込み先で別の予定として増えていた。
    const before = makeRule({
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
    // 編集画面を通したあとのルール（役割だけが書き換わりうる）。
    const after: Rule = {
      ...before,
      notices: [{ ...before.notices[0]!, role: 'before' }],
    };

    const uids = (rule: Rule): string[] => {
      const occurrences = expandRules([rule], { start: '2026-09-01', end: '2026-09-30' }, scheduleContext)
        .occurrences.filter((o) => o.kind !== 'main');
      return buildIcs(occurrences, new Map([[rule.id, rule]]), OPTIONS, NOW)
        .split('\r\n')
        .filter((line) => line.startsWith('UID:'));
    };

    expect(uids(after)).toEqual(uids(before));
    expect(uids(before)[0]).toContain('-notice-');
  });
});
