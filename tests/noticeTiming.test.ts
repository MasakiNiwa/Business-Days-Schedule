/**
 * 前後予定の「日付の決め方」（docs/SPEC.md §5.4）。
 *
 * 日数で数えるだけでは書けない実務の言い回し
 *   「翌週の水曜、水曜が休みなら木曜」
 *   「翌月の第5営業日」
 * を、そのまま設定できるようにしたぶんの検査。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMING,
  declaredRoleOf,
  noticeDate,
  noticeSpanDays,
  normalizeNotices,
  roleOf,
  timingOf,
  weekStartOf,
} from '../src/core/notice';
import { describeTiming } from '../src/core/describe';
import { expandRules } from '../src/core/schedule';
import { validateRule } from '../src/core/validate';
import { companyCalendar, makeCalendar, makeRule, scheduleContext } from './helpers';
import type { Notice, NoticeTiming } from '../src/types';

describe('weekStartOf', () => {
  it('週は月曜始まりで数える', () => {
    // 2026-09-09 は水曜。その週の頭は 09-07(月)。
    expect(weekStartOf('2026-09-09')).toBe('2026-09-07');
    expect(weekStartOf('2026-09-07')).toBe('2026-09-07');
    // 日曜は「前の週」に属する。翌週水曜が9日ぶん先へ飛ばないようにするため。
    expect(weekStartOf('2026-09-13')).toBe('2026-09-07');
  });
});

describe('週と曜日で決める', () => {
  const wednesdayNextWeek = (onClosed: 'next' | 'prev' | 'none'): NoticeTiming => ({
    kind: 'weekday',
    weeks: 1,
    weekday: 3,
    onClosed,
  });

  it('翌週の水曜を指す', () => {
    // 本体 2026-09-09(水) → 翌週の水曜は 09-16。
    expect(noticeDate('2026-09-09', wednesdayNextWeek('none'), companyCalendar)).toBe('2026-09-16');
  });

  it('本体が週のどこにあっても同じ週を起点にする', () => {
    // 09-07(月) も 09-11(金) も同じ週。翌週水曜はどちらも 09-16。
    for (const base of ['2026-09-07', '2026-09-11']) {
      expect(noticeDate(base, wednesdayNextWeek('none'), companyCalendar)).toBe('2026-09-16');
    }
  });

  it('同じ週・前の週も指せる', () => {
    expect(
      noticeDate('2026-09-09', { kind: 'weekday', weeks: 0, weekday: 5, onClosed: 'none' }, companyCalendar),
    ).toBe('2026-09-11');
    expect(
      noticeDate('2026-09-09', { kind: 'weekday', weeks: -1, weekday: 3, onClosed: 'none' }, companyCalendar),
    ).toBe('2026-09-02');
  });

  it('休業日なら翌営業日へ送る', () => {
    // 2026-09-23 は秋分の日(水)。翌営業日は 09-24(木)。
    expect(noticeDate('2026-09-16', wednesdayNextWeek('next'), companyCalendar)).toBe('2026-09-24');
    // そのまま置くなら休みの日のまま。
    expect(noticeDate('2026-09-16', wednesdayNextWeek('none'), companyCalendar)).toBe('2026-09-23');
  });

  it('休業日なら前営業日へ戻すこともできる', () => {
    expect(noticeDate('2026-09-16', wednesdayNextWeek('prev'), companyCalendar)).toBe('2026-09-18');
  });

  it('休業が続いても止まらない', () => {
    // 月曜だけ営業するカレンダーで火曜を指すと、翌営業日は次の月曜。
    const mondayOnly = makeCalendar({ id: 'mon', weekendDays: [0, 2, 3, 4, 5, 6], closedRanges: [] });
    expect(
      noticeDate('2026-09-07', { kind: 'weekday', weeks: 0, weekday: 2, onClosed: 'next' }, mondayOnly),
    ).toBe('2026-09-14');
  });
});

describe('月と第N営業日で決める', () => {
  it('翌月の第5営業日を指す', () => {
    // 2026-10月の営業日は 10-01(木),02(金),05(月),06(火),07(水)。
    expect(
      noticeDate('2026-09-25', { kind: 'monthlyBusinessDay', months: 1, nth: 5 }, companyCalendar),
    ).toBe('2026-10-07');
  });

  it('同じ月も指せる', () => {
    expect(
      noticeDate('2026-09-25', { kind: 'monthlyBusinessDay', months: 0, nth: 1 }, companyCalendar),
    ).toBe('2026-09-01');
  });

  it('負の N は月末から数える', () => {
    // 2026-10-30(金) が最終営業日。
    expect(
      noticeDate('2026-09-25', { kind: 'monthlyBusinessDay', months: 1, nth: -1 }, companyCalendar),
    ).toBe('2026-10-30');
  });

  it('営業日が足りなければ作らない', () => {
    expect(
      noticeDate('2026-09-25', { kind: 'monthlyBusinessDay', months: 1, nth: 40 }, companyCalendar),
    ).toBeNull();
  });
});

describe('roleOf', () => {
  it('日数指定は符号で前後が決まる', () => {
    expect(roleOf({ label: 'a', timing: { kind: 'offset', offset: -3, unit: 'business' } })).toBe('before');
    expect(roleOf({ label: 'a', timing: { kind: 'offset', offset: 3, unit: 'business' } })).toBe('after');
  });

  it('週や月も、ずらす数が 0 でなければ設定から向きが決まる', () => {
    expect(declaredRoleOf({ label: 'a', timing: { kind: 'weekday', weeks: 1, weekday: 3, onClosed: 'next' } })).toBe('after');
    expect(declaredRoleOf({ label: 'a', timing: { kind: 'weekday', weeks: -1, weekday: 3, onClosed: 'next' } })).toBe('before');
    expect(declaredRoleOf({ label: 'a', timing: { kind: 'monthlyBusinessDay', months: 1, nth: 5 } })).toBe('after');
  });

  it('同じ週・同じ月は設定から決まらない', () => {
    const timing: NoticeTiming = { kind: 'weekday', weeks: 0, weekday: 3, onClosed: 'next' };
    expect(declaredRoleOf({ label: 'a', timing })).toBeNull();
    // 決め方を差し替えるときの初期値としては、持っている意図を使う。
    expect(roleOf({ label: 'a', timing, role: 'before' })).toBe('before');
    expect(roleOf({ label: 'a', timing })).toBe('after');
  });
});

describe('古い形式の読み替え', () => {
  it('offset/unit を timing に均し、二重には持たない', () => {
    const legacy: Notice[] = [{ offset: -3, unit: 'business', label: '準備' }];
    const [normalized] = normalizeNotices(legacy);
    expect(normalized?.timing).toEqual({ kind: 'offset', offset: -3, unit: 'business' });
    expect(normalized?.offset).toBeUndefined();
    expect(normalized?.unit).toBeUndefined();
    // 既に書き出したぶんの UID を変えないよう、id は順番から付ける。
    expect(normalized?.id).toBe('n0');
  });

  it('timing も offset も無ければ既定で埋める', () => {
    expect(timingOf({ label: 'x' })).toEqual(DEFAULT_TIMING);
  });
});

describe('noticeSpanDays', () => {
  it('週で決めるものは前後どちらへも広げる', () => {
    const span = noticeSpanDays({ kind: 'weekday', weeks: 1, weekday: 3, onClosed: 'next' }, companyCalendar);
    expect(span.before).toBeGreaterThan(0);
    expect(span.after).toBeGreaterThan(0);
  });

  it('月で決めるものは月ぶんの幅を持つ', () => {
    const span = noticeSpanDays({ kind: 'monthlyBusinessDay', months: 1, nth: 5 }, companyCalendar);
    expect(span.before).toBeGreaterThanOrEqual(62);
    expect(span.after).toBeGreaterThanOrEqual(62);
  });
});

describe('展開', () => {
  const rule = makeRule({
    id: 'weekly-report',
    title: '月次締め',
    recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
    adjust: { mode: 'none', keepInMonth: false },
    notices: [
      {
        id: 'w1',
        label: '報告会',
        timing: { kind: 'weekday', weeks: 1, weekday: 3, onClosed: 'next' },
        role: 'after',
      },
    ],
  });

  it('本体ごとの週から数えてフォローを作る', () => {
    const occurrences = expandRules([rule], { start: '2026-09-01', end: '2026-09-30' }, scheduleContext)
      .occurrences.map((o) => [o.kind, o.date]);
    // 本体 09-10(木) の週は 09-07 始まり。翌週水曜は 09-16。
    expect(occurrences).toContainEqual(['main', '2026-09-10']);
    expect(occurrences).toContainEqual(['follow', '2026-09-16']);
  });

  it('本体が範囲より前にあってもフォローだけ出る', () => {
    const occurrences = expandRules([rule], { start: '2026-09-15', end: '2026-09-20' }, scheduleContext)
      .occurrences.map((o) => [o.kind, o.date]);
    expect(occurrences).toContainEqual(['follow', '2026-09-16']);
  });

  it('前営業日へ戻って本体を追い越したら、準備日として扱い食い違いを知らせる', () => {
    // 本体は 2026-09-20(日)。翌週の月曜 09-21 は敬老の日で、09-22・23 も休み。
    // 「休業日なら前営業日へ」だと 09-18(金) まで戻り、本体より前に出てしまう。
    const overtaking = makeRule({
      id: 'overtaking',
      title: '週次報告',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [20], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [
        {
          id: 'w2',
          label: '提出',
          timing: { kind: 'weekday', weeks: 1, weekday: 1, onClosed: 'prev' },
        },
      ],
    });
    const result = expandRules([overtaking], { start: '2026-09-01', end: '2026-09-30' }, scheduleContext);
    expect(result.occurrences.map((o) => [o.kind, o.date])).toContainEqual(['notice', '2026-09-18']);
    expect(result.warnings.map((w) => w.reason)).toContain('notice-role-mismatch');
  });

  it('向きが設定から決まらないもの（同じ週・同じ月）では食い違いを言わない', () => {
    // 「同じ週の水曜」は本体の位置しだいで前にも後にもなる。設定が向きを
    // 言っていない以上、どちらに出ても食い違いではない。
    const sameWeek = makeRule({
      id: 'same-week',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [11], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [
        { id: 's1', label: '打合せ', timing: { kind: 'weekday', weeks: 0, weekday: 3, onClosed: 'none' } },
      ],
    });
    const result = expandRules([sameWeek], { start: '2026-09-01', end: '2026-09-30' }, scheduleContext);
    // 本体 09-11(金) の同じ週の水曜は 09-09。本体より前に出る。
    expect(result.occurrences.map((o) => [o.kind, o.date])).toContainEqual(['notice', '2026-09-09']);
    expect(result.warnings.map((w) => w.reason)).not.toContain('notice-role-mismatch');
  });

  it('識別子は順番ではなく id から決まる', () => {
    const occurrence = expandRules([rule], { start: '2026-09-01', end: '2026-09-30' }, scheduleContext)
      .occurrences.find((o) => o.kind === 'follow');
    expect(occurrence?.noticeId).toBe('w1');
  });
});

describe('検証', () => {
  it('週の指定は上限を持つ', () => {
    const issues = validateRule(
      makeRule({
        title: 'x',
        notices: [{ label: 'y', timing: { kind: 'weekday', weeks: 999, weekday: 3, onClosed: 'next' } }],
      }),
    );
    expect(issues.map((i) => i.path)).toContain('notices[0].timing');
  });

  it('第N営業日の指定も上限を持つ', () => {
    const issues = validateRule(
      makeRule({
        title: 'x',
        notices: [{ label: 'y', timing: { kind: 'monthlyBusinessDay', months: 1, nth: 999 } }],
      }),
    );
    expect(issues.map((i) => i.path)).toContain('notices[0].timing');
  });

  it('上限内なら通す', () => {
    expect(
      validateRule(
        makeRule({
          title: 'x',
          notices: [
            { label: 'y', timing: { kind: 'weekday', weeks: 1, weekday: 3, onClosed: 'next' } },
            { label: 'z', timing: { kind: 'monthlyBusinessDay', months: 1, nth: 5 } },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('第N営業日に 0 は無い', () => {
    const issues = validateRule(
      makeRule({
        title: 'x',
        notices: [{ label: 'y', timing: { kind: 'monthlyBusinessDay', months: 1, nth: 0 } }],
      }),
    );
    expect(issues.map((i) => i.path)).toContain('notices[0].timing');
  });
});

describe('describeTiming', () => {
  it('週と曜日を日本語で言い切る', () => {
    expect(describeTiming({ kind: 'weekday', weeks: 1, weekday: 3, onClosed: 'next' })).toBe(
      '翌週の水曜 / 休業日なら翌営業日へ',
    );
    expect(describeTiming({ kind: 'weekday', weeks: 0, weekday: 5, onClosed: 'none' })).toBe('同じ週の金曜');
  });

  it('月と第N営業日を日本語で言い切る', () => {
    expect(describeTiming({ kind: 'monthlyBusinessDay', months: 1, nth: 5 })).toBe('翌月の第5営業日');
    expect(describeTiming({ kind: 'monthlyBusinessDay', months: 0, nth: -1 })).toBe('同じ月の最終営業日');
  });

  it('日数指定は従来どおり', () => {
    expect(describeTiming({ kind: 'offset', offset: -3, unit: 'business' })).toBe('3営業日前');
    expect(describeTiming({ kind: 'offset', offset: 4, unit: 'calendar' })).toBe('4日後');
  });
});
