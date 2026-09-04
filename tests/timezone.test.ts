/**
 * 実行環境のタイムゾーンによって結果が変わらないことの回帰テスト（docs/SPEC.md §7.3, §10.1）。
 *
 * 日付演算をローカル時刻系の API で書くと、UTC-5 などのゾーンで丸1日ずれる。
 * ここで各ゾーンを実際に切り替えて、同一の結果になることを固定する。
 */

import { afterAll, describe, expect, it } from 'vitest';
import { addDays, addMonths, lastDateOfMonth, makeDate, weekdayOf } from '../src/core/dateUtil';
import { expandRules } from '../src/core/schedule';
import { makeRule, scheduleContext } from './helpers';

const ZONES = ['UTC', 'Asia/Tokyo', 'America/New_York', 'Pacific/Kiritimati'];
const ORIGINAL_TZ = process.env.TZ;

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

function inZone<T>(zone: string, fn: () => T): T {
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

describe('タイムゾーン非依存', () => {
  it('前提: TZ の切り替えが実際に効いている', () => {
    // これが効いていないと以降のテストが素通りしてしまうため、まず前提を固定する。
    const localMidnightUtc = (): string => new Date(2026, 0, 1).toISOString();
    expect(inZone('UTC', localMidnightUtc)).not.toBe(inZone('America/New_York', localMidnightUtc));
  });

  it('日付演算の結果がゾーンによらず一致する', () => {
    const compute = (): unknown => ({
      add: addDays('2026-01-01', -1),
      month: addMonths('2026-01-31', 1),
      last: lastDateOfMonth(2026, 2),
      weekday: weekdayOf('2026-01-01'),
      made: makeDate(2026, 3, 1),
    });
    const expected = inZone('UTC', compute);
    for (const zone of ZONES) {
      expect(inZone(zone, compute), `TZ=${zone}`).toEqual(expected);
    }
  });

  it('ルール展開の結果がゾーンによらず一致する', () => {
    const rule = makeRule({
      recurrence: { type: 'monthlyByDay', interval: 1, days: [1, 'last'], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
      notices: [{ offset: -2, unit: 'business', label: '準備' }],
    });
    const compute = (): string[] =>
      expandRules([rule], { start: '2026-01-01', end: '2026-12-31' }, scheduleContext).occurrences.map(
        (o) => `${o.kind}:${o.rawDate}->${o.date}`,
      );

    const expected = inZone('UTC', compute);
    expect(expected.length).toBeGreaterThan(0);
    for (const zone of ZONES) {
      expect(inZone(zone, compute), `TZ=${zone}`).toEqual(expected);
    }
  });
});
