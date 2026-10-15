/**
 * 外部 AI に渡す登録内容（docs/SPEC.md §9.5）。
 *
 * 渡すのは利用者が選んだものだけ。メモは既定で渡さない。
 * 日付はこのアプリが計算したものを渡し、AI には計算させない。
 */

import { describe, expect, it } from 'vitest';
import {
  buildSharedData,
  calendarSnapshot,
  defaultShareOptions,
  OCCURRENCE_LINE_LIMIT,
  occurrenceSnapshot,
  ruleSnapshot,
} from '../src/core/aiContext';
import { readAiReply } from '../src/core/aiImport';
import { AI_IMPORT_FORMAT } from '../src/core/aiImport';
import { ruleRevision } from '../src/core/conflict';
import { bankCalendarDef, companyCalendarDef, makeRule, scheduleContext } from './helpers';

const calendars = [companyCalendarDef, bankCalendarDef];

const payment = makeRule({
  id: 'pay',
  title: '支払',
  calendarId: 'bank',
  group: '支払・振込',
  note: '取引先A社 1,200,000円',
  recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
  notices: [{ id: 'n0', label: '振込データ作成', timing: { kind: 'offset', offset: -3, unit: 'business' } }],
  skipDates: ['2026-12-25'],
});

describe('ruleSnapshot', () => {
  it('取り込みと同じ項目名で、id と rev を添える', () => {
    const snapshot = ruleSnapshot(payment, false);
    expect(snapshot).toEqual({
      id: 'pay',
      rev: ruleRevision(payment),
      title: '支払',
      calendarId: 'bank',
      group: '支払・振込',
      recurrence: payment.recurrence,
      adjust: payment.adjust,
      notices: [{ id: 'n0', label: '振込データ作成', timing: { kind: 'offset', offset: -3, unit: 'business' } }],
      color: 'blue',
    });
  });

  it('メモは選んだときだけ含める', () => {
    expect(JSON.stringify(ruleSnapshot(payment, false))).not.toContain('取引先A社');
    expect(ruleSnapshot(payment, true)).toMatchObject({ note: '取引先A社 1,200,000円' });
  });

  it('アプリが管理する項目は渡さず、一時停止中だけ印を付ける', () => {
    const snapshot = ruleSnapshot(payment, false);
    for (const key of ['createdAt', 'updatedAt', 'skipDates', 'enabled']) expect(snapshot).not.toHaveProperty(key);
    expect(ruleSnapshot({ ...payment, enabled: false }, false)).toMatchObject({ enabled: false });
  });

  it('写して返されたものは、そのまま取り込みの検証を通る', () => {
    const reply = JSON.stringify({ format: AI_IMPORT_FORMAT, schemaVersion: 1, rules: [ruleSnapshot(payment, true)] });
    const result = readAiReply(reply, { calendars, existingRules: [payment] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 何も変えていなければ「変更なし」。警告も出さない。
    expect(result.updates).toEqual([expect.objectContaining({ changed: false, stale: false })]);
    expect(result.issues).toEqual([]);
  });

  it('rev は中身が変わると変わる', () => {
    expect(ruleRevision(payment)).toMatch(/^[0-9a-f]{8}$/);
    expect(ruleRevision({ ...payment, title: '支払（本社）' })).not.toBe(ruleRevision(payment));
    // 保存し直しただけ（updatedAt だけ違う）では変わらない。
    expect(ruleRevision({ ...payment, updatedAt: '2030-01-01T00:00:00.000Z' })).toBe(ruleRevision(payment));
  });
});

describe('calendarSnapshot', () => {
  it('休業日の決め方を1行で書く', () => {
    const line = calendarSnapshot({ ...companyCalendarDef, closedDates: ['2026-11-02'], fiscalYearEndMonth: 9 });
    expect(line).toContain('"company"（自社カレンダー）');
    expect(line).toContain('休み: 日・土曜');
    expect(line).toContain('祝日は休み');
    expect(line).toContain('臨時休業日: 2026-11-02');
    expect(line).toContain('決算月: 9月');
  });
});

describe('occurrenceSnapshot', () => {
  it('アプリが計算した日付を、動いた理由とともに並べる', () => {
    const { from, to, lines, truncated } = occurrenceSnapshot([payment], scheduleContext, '2026-10-15', 1);
    expect(from).toBe('2026-10-01');
    expect(to).toBe('2026-10-31');
    expect(truncated).toBe(false);
    expect(lines).toEqual([
      '2026-10-20（火） 支払: 振込データ作成 [支払・振込]',
      '2026-10-23（金） 支払（本来は 2026-10-25（日）。休業日のため前へ） [支払・振込]',
    ]);
  });

  it('一時停止中の予定は載せない', () => {
    expect(occurrenceSnapshot([{ ...payment, enabled: false }], scheduleContext, '2026-10-15', 1).lines).toEqual([]);
  });

  it('多すぎるときは上限で切り、切ったことを返す', () => {
    const daily = makeRule({ id: 'daily', title: '残高確認', recurrence: { type: 'businessDays', interval: 1 } });
    const result = occurrenceSnapshot([daily], scheduleContext, '2026-01-01', 12 * 4);
    expect(result.truncated).toBe(true);
    expect(result.lines).toHaveLength(OCCURRENCE_LINE_LIMIT);
  });
});

describe('buildSharedData', () => {
  it('選んだものだけを組み立てる', () => {
    const none = buildSharedData({ rules: [payment], calendars }, defaultShareOptions('create'), scheduleContext, '2026-10-15');
    expect(none).toEqual({ asOf: '2026-10-15' });

    const all = buildSharedData(
      { rules: [payment], calendars },
      { rules: true, notes: false, calendars: true, occurrences: true, months: 1 },
      scheduleContext,
      '2026-10-15',
    );
    expect(all.rules?.lines).toHaveLength(1);
    expect(all.rules?.withNotes).toBe(false);
    expect(all.calendars).toHaveLength(2);
    expect(all.occurrences?.lines).toHaveLength(2);
  });

  it('頼むことごとの既定では、メモを渡さない', () => {
    for (const purpose of ['create', 'revise', 'review', 'handover', 'question'] as const) {
      expect(defaultShareOptions(purpose).notes).toBe(false);
    }
    expect(defaultShareOptions('revise').rules).toBe(true);
    expect(defaultShareOptions('question').occurrences).toBe(true);
  });
});
