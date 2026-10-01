/**
 * AI の回答の取り込み（docs/SPEC.md §9.5）。
 *
 * AI の回答は信用できない外部入力。決めた形どおりのものだけを通し、
 * 日付はこのアプリの営業日計算で出す。
 */

import { describe, expect, it } from 'vitest';
import {
  AI_IMPORT_FORMAT,
  AI_IMPORT_LIMITS,
  appendImportedRules,
  buildImportPreview,
  parseAiReply,
  readAiReply,
  validateAiImport,
} from '../src/core/aiImport';
import type { AiImportResult } from '../src/core/aiImport';
import { previewSeries } from '../src/core/schedule';
import { validateRule } from '../src/core/validate';
import type { Rule } from '../src/types';
import { bankCalendarDef, companyCalendarDef, makeRule, scheduleContext } from './helpers';

const calendars = [companyCalendarDef, bankCalendarDef];
const ctx = { calendars, now: new Date('2026-10-01T00:00:00.000Z') };

/** 依頼文の例と同じ「支払」。 */
const paymentRule = {
  title: '支払',
  calendarId: 'bank',
  recurrence: { type: 'monthlyByDay', days: [25] },
  adjust: { mode: 'prev' },
  notices: [
    { label: '振込データ作成', timing: { kind: 'offset', offset: -3, unit: 'business' } },
    { label: '支払確認', timing: { kind: 'offset', offset: 1, unit: 'business' } },
  ],
};

const file = (rules: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: AI_IMPORT_FORMAT,
  schemaVersion: 1,
  rules,
  ...extra,
});

const json = (value: unknown): string => JSON.stringify(value, null, 2);

function expectOk(result: AiImportResult): Rule[] {
  if (!result.ok) throw new Error(`取り込めませんでした: ${JSON.stringify(result.issues)}`);
  return result.rules;
}

function errorsOf(result: AiImportResult) {
  return result.issues.filter((issue) => issue.severity === 'error');
}

describe('parseAiReply: 回答から JSON を取り出す', () => {
  it('全体が JSON ならそのまま読む', () => {
    const result = parseAiReply(json(file([paymentRule])));
    expect(result).toMatchObject({ ok: true, source: 'whole' });
  });

  it('Markdown の json コードブロックから取り出す', () => {
    const text = `以下の設定になります。\n\n\`\`\`json\n${json(file([paymentRule]))}\n\`\`\`\n\n必要に応じて調整してください。`;
    const result = parseAiReply(text);
    expect(result).toMatchObject({ ok: true, source: 'codeBlock' });
  });

  it('言語名の無いコードブロックでも読む', () => {
    const result = parseAiReply(`はい。\n\`\`\`\n${json(file([paymentRule]))}\n\`\`\``);
    expect(result).toMatchObject({ ok: true, source: 'codeBlock' });
  });

  it('文中で ```json に触れていても、行頭の囲みだけを読む', () => {
    const text = `\`\`\`json の形で出力します。\n\n\`\`\`json\n${json(file([paymentRule]))}\n\`\`\``;
    expect(parseAiReply(text)).toMatchObject({ ok: true, source: 'codeBlock' });
  });

  it('前後に説明文があるだけの JSON も読む', () => {
    const text = `作成しました。${json(file([paymentRule]))} 以上です。{と}を含む文があっても構いません。`;
    const result = parseAiReply(text);
    expect(result).toMatchObject({ ok: true, source: 'embedded' });
  });

  it('文字列の中の括弧に惑わされない', () => {
    const rule = { ...paymentRule, title: '支払 {重要}', note: '} で終わるメモ {' };
    const result = parseAiReply(`説明\n${json(file([rule]))}\nおわり`);
    expect(result.ok).toBe(true);
  });

  it('構文の崩れた JSON は直さずにエラーにする', () => {
    const broken = '```json\n{ "format": "business-days-schedule-ai-import", "rules": [ { "title": "支払", } ] \n```';
    const result = parseAiReply(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.message).toContain('書き方が崩れて');
    expect(result.issue.fix).toContain('JSON の構文に誤り');
  });

  it('途中で切れた回答はそうと伝える', () => {
    const result = parseAiReply(`以下です。\n${json(file([paymentRule])).slice(0, 80)}`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.message).toContain('途中で切れて');
  });

  it('候補が複数あり決められなければエラーにする', () => {
    const text = `案1\n\`\`\`json\n${json(file([paymentRule]))}\n\`\`\`\n案2\n\`\`\`json\n${json(file([{ ...paymentRule, title: '別案' }]))}\n\`\`\``;
    const result = parseAiReply(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.message).toContain('複数');
  });

  it('複数あっても、この形を名乗るものが1つだけならそれを選ぶ', () => {
    const text = `例: {"a": 1}\n本番:\n${json(file([paymentRule]))}`;
    const result = parseAiReply(text);
    expect(result).toMatchObject({ ok: true, source: 'embedded' });
  });

  it('JSON が無ければそう伝える', () => {
    const result = parseAiReply('どんな予定を作りますか？');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.message).toContain('見つかりませんでした');
  });

  it('空なら貼り付けを促す', () => {
    expect(parseAiReply('   ')).toMatchObject({ ok: false, issue: { message: 'AIの回答を貼り付けてください。' } });
  });

  it('長すぎる入力は読まない', () => {
    const result = parseAiReply('a'.repeat(AI_IMPORT_LIMITS.inputLength + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue.message).toContain('長すぎます');
  });

  it('深すぎる入れ子でも例外を投げない', () => {
    const deep = `${'['.repeat(200_00)}${']'.repeat(200_00)}`;
    expect(() => parseAiReply(deep)).not.toThrow();
  });
});

describe('validateAiImport: 正常系', () => {
  it('依頼文の例どおりの予定を Rule に組み直す', () => {
    const [rule] = expectOk(readAiReply(json(file([paymentRule])), ctx));
    expect(rule).toMatchObject({
      title: '支払',
      calendarId: 'bank',
      enabled: true,
      recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
      period: { start: null, end: null },
      skipDates: [],
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    expect(rule?.notices.map((notice) => notice.label)).toEqual(['振込データ作成', '支払確認']);
    // 前後予定の id は読み込みの時点で振る（外部カレンダーの UID に使う）。
    expect(rule?.notices.every((notice) => typeof notice.id === 'string')).toBe(true);
    // 保存されているルールと同じ検証を通る。
    expect(validateRule(rule as Rule)).toEqual([]);
  });

  it('複数の予定をまとめて読む', () => {
    const rules = expectOk(
      validateAiImport(
        file([
          paymentRule,
          { title: '定例会議', recurrence: { type: 'monthlyByWeekday', nth: [2, 4], weekday: 2 }, adjust: { mode: 'none' } },
          { title: '請求書発行', recurrence: { type: 'monthlyByBusinessDay', nth: [5] } },
          { title: '週次報告', recurrence: { type: 'weekly', weekdays: [5] }, adjust: { mode: 'prev' } },
          { title: '法人税申告', recurrence: { type: 'fiscalRelative', offsetMonths: [2], day: 'last' }, adjust: { mode: 'next' } },
        ]),
        ctx,
      ),
    );
    expect(rules.map((rule) => rule.recurrence.type)).toEqual([
      'monthlyByDay',
      'monthlyByWeekday',
      'monthlyByBusinessDay',
      'weekly',
      'fiscalRelative',
    ]);
    // 第N営業日は休業日の扱いが効かないので none に均す。
    expect(rules[2]?.adjust).toEqual({ mode: 'none', keepInMonth: false });
    // カレンダーを省けば最初のもの。
    expect(rules[1]?.calendarId).toBe('company');
    // id はすべてこちらで振り、重ならない。
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(5);
  });

  it('週・月で決める前後予定も読む', () => {
    const [rule] = expectOk(
      validateAiImport(
        file([
          {
            title: '月末締め',
            recurrence: { type: 'monthlyByDay', days: ['last'] },
            adjust: { mode: 'none' },
            notices: [
              { label: '請求書発行', timing: { kind: 'monthlyBusinessDay', months: 1, nth: 5 } },
              { label: '報告', timing: { kind: 'weekday', weeks: 1, weekday: 3, onClosed: 'next' } },
            ],
          },
        ]),
        ctx,
      ),
    );
    expect(rule?.recurrence).toMatchObject({ days: ['last'] });
    expect(rule?.notices.map((notice) => notice.timing?.kind)).toEqual(['monthlyBusinessDay', 'weekday']);
  });

  it('日にちの重複は取り除いて並べ直す', () => {
    const [rule] = expectOk(
      validateAiImport(file([{ ...paymentRule, recurrence: { type: 'monthlyByDay', days: [25, 10, 25, 'last'] } }]), ctx),
    );
    expect(rule?.recurrence).toMatchObject({ days: [10, 25, 'last'] });
  });

  it('id や日時はアプリ側で付け直し、警告にとどめる', () => {
    const result = validateAiImport(
      file([{ ...paymentRule, id: 'existing-id', enabled: false, createdAt: '1999-01-01' }]),
      ctx,
    );
    const [rule] = expectOk(result);
    expect(rule?.id).not.toBe('existing-id');
    expect(rule?.enabled).toBe(true);
    expect(rule?.createdAt).toBe('2026-10-01T00:00:00.000Z');
    expect(result.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.path)).toEqual([
      'rules[0].id',
      'rules[0].enabled',
      'rules[0].createdAt',
    ]);
  });

  it('一番外側の知らない項目は警告にして無視する', () => {
    const result = validateAiImport(file([paymentRule], { explanation: '説明です' }), ctx);
    expectOk(result);
    expect(result.issues).toEqual([
      expect.objectContaining({ severity: 'warning', path: 'explanation' }),
    ]);
  });

  it('隔週で基準日が無ければ警告する（登録は止めない）', () => {
    const result = validateAiImport(
      file([{ title: '1on1', recurrence: { type: 'weekly', interval: 2, weekdays: [3] }, adjust: { mode: 'none' } }]),
      ctx,
    );
    expectOk(result);
    expect(result.issues[0]).toMatchObject({ severity: 'warning', path: 'rules[0].recurrence.anchor' });
  });
});

describe('validateAiImport: 形の誤り', () => {
  it('format が違えば読まない', () => {
    const result = validateAiImport({ ...file([paymentRule]), format: 'something-else' }, ctx);
    expect(result.ok).toBe(false);
    expect(errorsOf(result)[0]?.path).toBe('format');
  });

  it('バックアップのファイルを貼られたら、インポートへ案内する', () => {
    const backup = { schemaVersion: 1, exportedAt: '2026-01-01', calendars: [], rules: [], prefs: {} };
    const result = validateAiImport(backup, ctx);
    expect(result.ok).toBe(false);
    expect(errorsOf(result)[0]?.message).toContain('印（format）がありません');
  });

  it('schemaVersion が違えば読まない', () => {
    expect(validateAiImport({ ...file([paymentRule]), schemaVersion: 2 }, ctx)).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ path: 'schemaVersion', message: expect.stringContaining('新しい形式') })],
    });
    expect(validateAiImport({ ...file([paymentRule]), schemaVersion: '1' }, ctx).ok).toBe(false);
  });

  it('配列や文字列は読まない', () => {
    expect(validateAiImport([paymentRule], ctx).ok).toBe(false);
    expect(validateAiImport('rules', ctx).ok).toBe(false);
    expect(validateAiImport(null, ctx).ok).toBe(false);
  });

  it('予定が無い・多すぎるときは読まない', () => {
    expect(validateAiImport(file([]), ctx).ok).toBe(false);
    const many = Array.from({ length: AI_IMPORT_LIMITS.rules + 1 }, () => paymentRule);
    const result = validateAiImport(file(many), ctx);
    expect(result.ok).toBe(false);
    expect(errorsOf(result)[0]?.message).toContain(`${AI_IMPORT_LIMITS.rules} 件まで`);
  });
});

describe('validateAiImport: 中身の誤り', () => {
  it('使えない列挙値は、利用者向けの言葉と AI 向けの直し方を返す', () => {
    const result = validateAiImport(file([{ ...paymentRule, adjust: { mode: 'previousBusinessDay' } }]), ctx);
    expect(result.ok).toBe(false);
    const [issue] = errorsOf(result);
    expect(issue).toMatchObject({ path: 'rules[0].adjust.mode', subject: '1件目「支払」' });
    // JSON の知識を求めない言い方。
    expect(issue?.message).toBe(
      'AIから返された「休業日の扱い」に、このアプリでは使えない設定（"previousBusinessDay"）が含まれています。',
    );
    // AI には使える値まで伝える。
    expect(issue?.fix).toContain('"none" / "prev" / "next" / "nearest" / "both"');
  });

  it('知らない繰り返しの種類は読まない', () => {
    const result = validateAiImport(file([{ ...paymentRule, recurrence: { type: 'yearly', month: 4 } }]), ctx);
    expect(errorsOf(result)[0]?.path).toBe('rules[0].recurrence.type');
  });

  it('必須の値が無ければ読まない', () => {
    const { title: _title, ...noTitle } = paymentRule;
    expect(errorsOf(validateAiImport(file([noTitle]), ctx))[0]?.path).toBe('rules[0].title');
    const { recurrence: _recurrence, ...noRecurrence } = paymentRule;
    expect(errorsOf(validateAiImport(file([noRecurrence]), ctx))[0]?.path).toBe('rules[0].recurrence');
    // 休業日の扱いは勝手に補わない（第N営業日を除く）。
    const { adjust: _adjust, ...noAdjust } = paymentRule;
    expect(errorsOf(validateAiImport(file([noAdjust]), ctx))[0]?.path).toBe('rules[0].adjust');
  });

  it('空のタイトルは読まない', () => {
    expect(validateAiImport(file([{ ...paymentRule, title: '   ' }]), ctx).ok).toBe(false);
  });

  it('範囲外の数値は読まない', () => {
    const cases: unknown[] = [
      { ...paymentRule, recurrence: { type: 'monthlyByDay', days: [32] } },
      { ...paymentRule, recurrence: { type: 'monthlyByDay', days: [0] } },
      { ...paymentRule, recurrence: { type: 'monthlyByDay', days: [25], interval: 0 } },
      { ...paymentRule, recurrence: { type: 'monthlyByDay', days: [25], months: [13] } },
      { ...paymentRule, recurrence: { type: 'monthlyByWeekday', nth: [6], weekday: 1 } },
      { ...paymentRule, recurrence: { type: 'monthlyByWeekday', nth: [1], weekday: 7 } },
      { title: 'x', recurrence: { type: 'monthlyByBusinessDay', nth: [0] } },
      { title: 'x', recurrence: { type: 'monthlyByBusinessDay', nth: [40] } },
      { ...paymentRule, notices: [{ label: 'x', timing: { kind: 'offset', offset: 0, unit: 'business' } }] },
      { ...paymentRule, notices: [{ label: 'x', timing: { kind: 'offset', offset: 400, unit: 'business' } }] },
      { ...paymentRule, notices: [{ label: 'x', timing: { kind: 'monthlyBusinessDay', months: 1, nth: 0 } }] },
    ];
    for (const rule of cases) {
      expect(validateAiImport(file([rule]), ctx).ok, JSON.stringify(rule)).toBe(false);
    }
  });

  it('数値の代わりに文字列が来ても読み替えない', () => {
    const result = validateAiImport(file([{ ...paymentRule, recurrence: { type: 'monthlyByDay', days: ['25'] } }]), ctx);
    expect(result.ok).toBe(false);
    expect(errorsOf(result)[0]?.message).toContain('"25"');
  });

  it('存在しない営業日カレンダーは読まない', () => {
    const result = validateAiImport(file([{ ...paymentRule, calendarId: 'tokyo-bank' }]), ctx);
    expect(result.ok).toBe(false);
    const [issue] = errorsOf(result);
    expect(issue?.path).toBe('rules[0].calendarId');
    expect(issue?.message).toContain('「自社カレンダー」か「銀行休業日」');
    expect(issue?.fix).toContain('"company" / "bank"');
  });

  it('予定の中の知らない項目はエラーにする（書き間違いで設定が抜けるのを防ぐ）', () => {
    const { adjust: _adjust, ...rest } = paymentRule;
    const result = validateAiImport(file([{ ...rest, adjustment: 'previousBusinessDay' }]), ctx);
    expect(result.ok).toBe(false);
    expect(errorsOf(result).map((issue) => issue.path)).toContain('rules[0].adjustment');
  });

  it('繰り返しや前後予定の中の知らない項目もエラーにする', () => {
    expect(
      validateAiImport(file([{ ...paymentRule, recurrence: { type: 'monthlyByDay', days: [25], weekday: 1 } }]), ctx).ok,
    ).toBe(false);
    expect(
      validateAiImport(
        file([{ ...paymentRule, notices: [{ label: 'x', timing: { kind: 'offset', offset: -1, unit: 'business', date: '2026-10-22' } }] }]),
        ctx,
      ).ok,
    ).toBe(false);
  });

  it('前後予定の不正な設定は読まない', () => {
    const bad: unknown[] = [
      [{ label: '', timing: { kind: 'offset', offset: -1, unit: 'business' } }],
      [{ label: 'x' }],
      [{ label: 'x', timing: { kind: 'offset', offset: -1, unit: 'hours' } }],
      [{ label: 'x', timing: { kind: 'weekday', weeks: 1, weekday: 3 } }],
      [{ label: 'x', timing: { kind: 'offset', offset: -1, unit: 'business' }, role: 'during' }],
      'notices',
      Array.from({ length: 21 }, () => ({ label: 'x', timing: { kind: 'offset', offset: -1, unit: 'business' } })),
    ];
    for (const notices of bad) {
      expect(validateAiImport(file([{ ...paymentRule, notices }]), ctx).ok, JSON.stringify(notices)).toBe(false);
    }
  });

  it('有効期間の不正な日付は読まない', () => {
    expect(validateAiImport(file([{ ...paymentRule, period: { start: '2026-02-30', end: null } }]), ctx).ok).toBe(false);
    expect(validateAiImport(file([{ ...paymentRule, period: { start: '2027-01-01', end: '2026-01-01' } }]), ctx).ok).toBe(false);
    const [rule] = expectOk(validateAiImport(file([{ ...paymentRule, period: { start: '2026-10-01', end: null } }]), ctx));
    expect(rule?.period).toEqual({ start: '2026-10-01', end: null });
  });

  it('1件でもエラーがあれば、残りも取り込まない', () => {
    const result = validateAiImport(file([paymentRule, { ...paymentRule, adjust: { mode: 'later' } }]), ctx);
    expect(result.ok).toBe(false);
    expect('rules' in result).toBe(false);
    expect(errorsOf(result)[0]?.subject).toBe('2件目「支払」');
  });

  it('壊れ方がひどくても、出す指摘の数は抑える', () => {
    const rules = Array.from({ length: AI_IMPORT_LIMITS.rules }, () => ({ nonsense: 1, more: 2 }));
    const result = validateAiImport(file(rules), ctx);
    expect(result.issues.length).toBeLessThanOrEqual(AI_IMPORT_LIMITS.issues);
  });
});

describe('validateAiImport: 悪意のある入力', () => {
  it('HTML を含む名前は文字として扱う（実行は画面側で起きない）', () => {
    const [rule] = expectOk(
      validateAiImport(file([{ ...paymentRule, title: '<img src=x onerror=alert(1)>' }]), ctx),
    );
    expect(rule?.title).toBe('<img src=x onerror=alert(1)>');
  });

  it('__proto__ を含めても Object.prototype を汚さない', () => {
    const text = `{"format":"${AI_IMPORT_FORMAT}","schemaVersion":1,"__proto__":{"polluted":true},"rules":[{"title":"支払","recurrence":{"type":"monthlyByDay","days":[25]},"adjust":{"mode":"prev"},"constructor":{"prototype":{"polluted":true}}}]}`;
    const result = readAiReply(text, ctx);
    // 予定の中の知らない項目なのでエラー。
    expect(result.ok).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();

    const topOnly = `{"format":"${AI_IMPORT_FORMAT}","schemaVersion":1,"__proto__":{"polluted":true},"rules":[{"title":"支払","recurrence":{"type":"monthlyByDay","days":[25]},"adjust":{"mode":"prev"}}]}`;
    const [rule] = expectOk(readAiReply(topOnly, ctx));
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.getPrototypeOf(rule)).toBe(Object.prototype);
    expect((rule as unknown as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('名前に改行や制御文字があれば読まない', () => {
    expect(validateAiImport(file([{ ...paymentRule, title: '支払\nevil' }]), ctx).ok).toBe(false);
    expect(validateAiImport(file([{ ...paymentRule, title: '支払\u0000' }]), ctx).ok).toBe(false);
  });

  it('長すぎる名前は読まない', () => {
    expect(validateAiImport(file([{ ...paymentRule, title: 'あ'.repeat(201) }]), ctx).ok).toBe(false);
  });
});

describe('buildImportPreview: 日付はこのアプリの計算で出す', () => {
  it('プレビューの日付は、同じ設定を手で作ったルールの previewSeries と一致する', () => {
    const [imported] = expectOk(readAiReply(json(file([paymentRule])), ctx));
    const [item] = buildImportPreview([imported as Rule], calendars, scheduleContext, '2026-10-01');

    const handmade = makeRule({
      calendarId: 'bank',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
      notices: [
        { id: 'a', label: '振込データ作成', timing: { kind: 'offset', offset: -3, unit: 'business' } },
        { id: 'b', label: '支払確認', timing: { kind: 'offset', offset: 1, unit: 'business' } },
      ],
    });
    const expected = previewSeries(handmade, '2026-10-01', 3, scheduleContext);

    const dates = (series: typeof expected) =>
      series.map(({ main, related }) => [main.date, ...related.map((occurrence) => occurrence.date)]);
    expect(dates(item?.series ?? [])).toEqual(dates(expected));
    // 2026-10-25 は日曜なので前営業日の 10-23（金）。準備は3営業日前（10-20）、確認は翌営業日（10-26）。
    expect(dates(item?.series ?? [])[0]).toEqual(['2026-10-23', '2026-10-20', '2026-10-26']);
    expect(item?.series[0]?.main.shifted).toBe(true);
  });

  it('説明はルール一覧と同じ言い方にする', () => {
    const [imported] = expectOk(readAiReply(json(file([paymentRule])), ctx));
    const [item] = buildImportPreview([imported as Rule], calendars, scheduleContext, '2026-10-01');
    expect(item?.summary).toBe('毎月25日 / 休業日なら前営業日');
    expect(item?.calendarName).toBe('銀行休業日');
    expect(item?.notices).toEqual(['3営業日前: 振込データ作成', '1営業日後: 支払確認']);
  });
});

describe('appendImportedRules: 既存のデータを変えない', () => {
  it('既存のルールはそのまま（同じ参照）で、後ろに足す', () => {
    const existing = [makeRule({ id: 'a', title: '既存A' }), makeRule({ id: 'b', title: '既存B' })];
    const snapshot = structuredClone(existing);
    const incoming = expectOk(readAiReply(json(file([paymentRule])), ctx));
    const next = appendImportedRules(existing, incoming);
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(existing[0]);
    expect(next[1]).toBe(existing[1]);
    expect(existing).toEqual(snapshot);
    expect(next[2]?.title).toBe('支払');
  });

  it('id が重なったら、取り込む側を付け直す（上書きしない）', () => {
    const existing = [makeRule({ id: 'same', title: '既存' })];
    const incoming = [makeRule({ id: 'same', title: '取り込み' })];
    const next = appendImportedRules(existing, incoming);
    expect(next.map((rule) => rule.title)).toEqual(['既存', '取り込み']);
    expect(next[0]?.id).toBe('same');
    expect(next[1]?.id).not.toBe('same');
  });
});
