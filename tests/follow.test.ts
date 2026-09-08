/**
 * フォロー予定（本体より後ろ）— docs/SPEC.md §5.4。
 *
 * 準備日と符号が逆になるだけだが、展開範囲の広げ方が逆向きになるため、
 * そこを外すと「本体が前の月にあるフォロー」が黙って消える。
 */

import { describe, expect, it } from 'vitest';
import { expandRules, followRangeStart, noticeDateOf } from '../src/core/schedule';
import { describeNotice } from '../src/core/describe';
import { companyCalendar, makeRule, scheduleContext } from './helpers';
import type { Occurrence } from '../src/types';

const invoice = makeRule({
  id: 'invoice',
  title: '請求書発行',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [5], overflow: 'clamp' },
  adjust: { mode: 'none', keepInMonth: false },
  notices: [{ offset: 5, unit: 'business', label: '入金消込' }],
});

const between = (start: string, end: string, rules = [invoice]): Occurrence[] =>
  expandRules(rules, { start, end }, scheduleContext).occurrences;

describe('noticeDateOf', () => {
  it('正の offset は本体より後ろへ数える', () => {
    // 2026-09-04(金) の3営業日後は 09-09(水)。
    expect(
      noticeDateOf('2026-09-04', { offset: 3, unit: 'business', label: 'x' }, companyCalendar),
    ).toBe('2026-09-09');
  });

  it('負の offset は本体より前へ数える（従来どおり）', () => {
    expect(
      noticeDateOf('2026-09-09', { offset: -3, unit: 'business', label: 'x' }, companyCalendar),
    ).toBe('2026-09-04');
  });

  it('暦日でも前後どちらへも数える', () => {
    expect(
      noticeDateOf('2026-09-10', { offset: 4, unit: 'calendar', label: 'x' }, companyCalendar),
    ).toBe('2026-09-14');
    expect(
      noticeDateOf('2026-09-10', { offset: -4, unit: 'calendar', label: 'x' }, companyCalendar),
    ).toBe('2026-09-06');
  });

  it('0 は本体と同じ日なので作らない', () => {
    expect(
      noticeDateOf('2026-09-10', { offset: 0, unit: 'business', label: 'x' }, companyCalendar),
    ).toBeNull();
  });
});

describe('followRangeStart', () => {
  it('フォローの日数だけ探索の先頭を戻す', () => {
    // これが無いと、本体が範囲より前にあるフォローが生成されない。
    const start = followRangeStart(invoice, '2026-09-01', companyCalendar);
    expect(start < '2026-09-01').toBe(true);
  });

  it('準備日しか無いルールでは戻さない', () => {
    const rule = makeRule({
      id: 'p',
      notices: [{ offset: -3, unit: 'business', label: '準備' }],
    });
    expect(followRangeStart(rule, '2026-09-01', companyCalendar)).toBe('2026-09-01');
  });
});

describe('expandRules とフォロー', () => {
  it('本体の後ろにフォローを作る', () => {
    const kinds = between('2026-09-01', '2026-09-30').map((o) => [o.kind, o.date]);
    expect(kinds).toContainEqual(['main', '2026-09-05']);
    // 2026-09-05(土) の5営業日後。土日を挟むので 09-11(金)。
    expect(kinds).toContainEqual(['follow', '2026-09-11']);
  });

  it('本体が表示範囲より前でもフォローだけは出る', () => {
    // 本体は 09-05。フォローの 09-11 だけを含む範囲で数える。
    const found = between('2026-09-10', '2026-09-20');
    expect(found.map((o) => [o.kind, o.date])).toEqual([['follow', '2026-09-11']]);
  });

  it('長いフォローでも、本体が範囲のはるか前にあるものを取りこぼさない', () => {
    // 展開範囲は既定で前後1か月ぶんしか広げない。60営業日（約3か月）後の
    // フォローは、本体がその外側にあるため、範囲を戻さないと生成されない。
    const rule = makeRule({
      id: 'long',
      title: '長期フォロー',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [5], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [{ offset: 60, unit: 'business', label: '検収' }],
    });
    const found = between('2026-09-01', '2026-09-30', [rule]);
    const follows = found.filter((o) => o.kind === 'follow');
    expect(follows.length).toBeGreaterThan(0);
    // 本体は約3か月前（6月5日ごろ）にある。
    for (const follow of follows) expect(follow.rawDate < '2026-07-01').toBe(true);
  });

  it('年をまたぐ長いフォローも出る', () => {
    const rule = makeRule({
      id: 'across-year',
      title: '年またぎ',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [20], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [{ offset: 90, unit: 'calendar', label: '確認' }],
    });
    const found = expandRules(
      [rule],
      { start: '2027-01-01', end: '2027-01-31' },
      scheduleContext,
    ).occurrences.filter((o) => o.kind === 'follow');
    expect(found.length).toBeGreaterThan(0);
    for (const follow of found) expect(follow.rawDate.startsWith('2026-')).toBe(true);
  });

  it('同じ日では本体・準備日・フォローの順に並べる', () => {
    const rule = makeRule({
      id: 'same',
      title: '重なる',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
      adjust: { mode: 'none', keepInMonth: false },
      notices: [
        { offset: 3, unit: 'calendar', label: 'あと' },
        { offset: -3, unit: 'calendar', label: 'まえ' },
      ],
    });
    // 10日・13日・7日にそれぞれ出る。順序は日付が優先なので、
    // 同じ日に重なる並びは kind 順で確かめる。
    const onSameDay = expandRules([rule], { start: '2026-09-07', end: '2026-09-13' }, scheduleContext)
      .occurrences.filter((o) => o.date === '2026-09-10');
    expect(onSameDay.map((o) => o.kind)).toEqual(['main']);

    const all = between('2026-09-01', '2026-09-30', [rule]);
    expect(all.map((o) => [o.date, o.kind])).toEqual([
      ['2026-09-07', 'notice'],
      ['2026-09-10', 'main'],
      ['2026-09-13', 'follow'],
    ]);
  });

  it('本体が営業日補正で動けばフォローも一緒に動く', () => {
    const rule = makeRule({
      id: 'shift',
      title: '締め',
      // 2026-09-05 は土曜。前営業日 09-04(金) へ動く。
      recurrence: { type: 'monthlyByDay', interval: 1, days: [5], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
      notices: [{ offset: 1, unit: 'business', label: '確認' }],
    });
    const found = between('2026-09-01', '2026-09-30', [rule]);
    expect(found.find((o) => o.kind === 'main')?.date).toBe('2026-09-04');
    // 起点は補正後の確定日。09-04(金) の翌営業日は 09-07(月)。
    expect(found.find((o) => o.kind === 'follow')?.date).toBe('2026-09-07');
  });

  it('フォローは本体の基準日を引き継ぐ（識別子が動かない）', () => {
    const follow = between('2026-09-01', '2026-09-30').find((o) => o.kind === 'follow');
    expect(follow?.baseDate).toBe('2026-09-05');
    expect(follow?.rawDate).toBe('2026-09-05');
  });
});

describe('describeNotice', () => {
  it('向きを言葉で出す', () => {
    expect(describeNotice(-3, 'business')).toBe('3営業日前');
    expect(describeNotice(3, 'business')).toBe('3営業日後');
    expect(describeNotice(-2, 'calendar')).toBe('2日前');
    expect(describeNotice(2, 'calendar')).toBe('2日後');
  });
});
