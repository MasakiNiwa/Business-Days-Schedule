import { describe, expect, it } from 'vitest';
import { adjustToBusinessDay } from '../src/core/adjust';
import type { Adjustment } from '../src/types';
import { companyCalendar, makeCalendar } from './helpers';

const adj = (mode: Adjustment['mode'], keepInMonth = false): Adjustment => ({ mode, keepInMonth });

describe('補正なしのケース', () => {
  it('営業日ならそのまま', () => {
    expect(adjustToBusinessDay('2026-09-04', adj('prev'), companyCalendar)).toEqual({
      date: '2026-09-04',
      shifted: false,
      direction: null,
    });
  });

  it('mode: none は休業日でもずらさない', () => {
    expect(adjustToBusinessDay('2026-09-21', adj('none'), companyCalendar)).toEqual({
      date: '2026-09-21',
      shifted: false,
      direction: null,
    });
  });
});

describe('prev / next', () => {
  it('連休をまたいで補正する', () => {
    // 2026-09-19(土)〜09-23(水) の5連休
    expect(adjustToBusinessDay('2026-09-21', adj('prev'), companyCalendar)).toEqual({
      date: '2026-09-18',
      shifted: true,
      direction: 'prev',
    });
    expect(adjustToBusinessDay('2026-09-21', adj('next'), companyCalendar)).toEqual({
      date: '2026-09-24',
      shifted: true,
      direction: 'next',
    });
  });

  it('年末年始休業をまたいで補正する', () => {
    expect(adjustToBusinessDay('2026-01-01', adj('prev'), companyCalendar)?.date).toBe('2025-12-26');
    expect(adjustToBusinessDay('2026-01-01', adj('next'), companyCalendar)?.date).toBe('2026-01-05');
  });
});

describe('nearest', () => {
  it('近い方を選ぶ', () => {
    // 2026-09-05(土): 前=9/4(1日前), 後=9/7(2日後)
    expect(adjustToBusinessDay('2026-09-05', adj('nearest'), companyCalendar)).toEqual({
      date: '2026-09-04',
      shifted: true,
      direction: 'prev',
    });
    // 2026-09-06(日): 前=9/4(2日前), 後=9/7(1日後)
    expect(adjustToBusinessDay('2026-09-06', adj('nearest'), companyCalendar)).toEqual({
      date: '2026-09-07',
      shifted: true,
      direction: 'next',
    });
  });

  it('距離が同じなら前倒しを優先する', () => {
    // 2026-04-29(水・昭和の日) は前後とも営業日で距離1。
    expect(adjustToBusinessDay('2026-04-29', adj('nearest'), companyCalendar)).toEqual({
      date: '2026-04-28',
      shifted: true,
      direction: 'prev',
    });
  });
});

describe('keepInMonth', () => {
  it('prev が月をまたぐときは next へ倒す', () => {
    // 2026-08-01(土)。通常の prev は 7/31(金)。
    expect(adjustToBusinessDay('2026-08-01', adj('prev'), companyCalendar)?.date).toBe('2026-07-31');
    expect(adjustToBusinessDay('2026-08-01', adj('prev', true), companyCalendar)).toEqual({
      date: '2026-08-03',
      shifted: true,
      direction: 'next',
    });
  });

  it('next が月をまたぐときは prev へ倒す', () => {
    // 2026-05-31(日)。通常の next は 6/1(月)。
    expect(adjustToBusinessDay('2026-05-31', adj('next'), companyCalendar)?.date).toBe('2026-06-01');
    expect(adjustToBusinessDay('2026-05-31', adj('next', true), companyCalendar)).toEqual({
      date: '2026-05-29',
      shifted: true,
      direction: 'prev',
    });
  });

  it('nearest でも当月内の候補を選ぶ', () => {
    expect(adjustToBusinessDay('2026-08-01', adj('nearest', true), companyCalendar)?.date).toBe(
      '2026-08-03',
    );
  });

  it('当月内に営業日が無ければ null', () => {
    const calendar = makeCalendar({
      closedRanges: [{ from: '08-01', to: '08-31', label: '長期休業' }],
    });
    expect(adjustToBusinessDay('2026-08-15', adj('prev', true), calendar)).toBeNull();
  });
});

describe('探索上限', () => {
  it('営業日が見つからなければ null', () => {
    const alwaysClosed = makeCalendar({ weekendDays: [0, 1, 2, 3, 4, 5, 6] });
    expect(adjustToBusinessDay('2026-09-21', adj('prev'), alwaysClosed)).toBeNull();
    expect(adjustToBusinessDay('2026-09-21', adj('nearest'), alwaysClosed)).toBeNull();
  });
});
