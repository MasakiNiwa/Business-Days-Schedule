/**
 * AI の回答で登録済みの予定を直す（docs/SPEC.md §9.5）。
 *
 * 直せるのは、id が手元のルールと一致するものだけ。AI が省いた項目は
 * そのまま残し（メモを渡していなければ AI はメモを書かない）、
 * 前後予定の id は引き継ぐ（外部カレンダーの UID を変えないため）。
 */

import { describe, expect, it } from 'vitest';
import { ruleSnapshot } from '../src/core/aiContext';
import {
  AI_IMPORT_FORMAT,
  applyAiImport,
  buildUpdatePreview,
  describeRuleChanges,
  validateAiImport,
} from '../src/core/aiImport';
import type { AiImportResult, RuleUpdate } from '../src/core/aiImport';
import { ruleRevision } from '../src/core/conflict';
import type { Rule } from '../src/types';
import { bankCalendarDef, companyCalendarDef, makeRule, scheduleContext } from './helpers';

const calendars = [companyCalendarDef, bankCalendarDef];

const payment = makeRule({
  id: 'pay',
  title: '支払',
  calendarId: 'bank',
  group: '支払・振込',
  note: '取引先A社',
  enabled: false,
  recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
  adjust: { mode: 'prev', keepInMonth: false },
  notices: [
    { id: 'n0', label: '振込データ作成', timing: { kind: 'offset', offset: -3, unit: 'business' } },
    { id: 'n1', label: '支払確認', timing: { kind: 'offset', offset: 1, unit: 'business' } },
  ],
  skipDates: ['2026-12-25'],
});
const closing = makeRule({ id: 'close', title: '月次締め' });
const existingRules = [payment, closing];
const ctx = { calendars, existingRules, now: new Date('2026-10-15T00:00:00.000Z') };

const file = (rules: unknown[]): Record<string, unknown> => ({ format: AI_IMPORT_FORMAT, schemaVersion: 1, rules });

/** AI に渡した形（メモなし）をもとに、一部だけ変えたもの。 */
const edited = (changes: Record<string, unknown>): Record<string, unknown> => ({ ...ruleSnapshot(payment, false), ...changes });

function expectOk(result: AiImportResult): { rules: Rule[]; updates: RuleUpdate[] } {
  if (!result.ok) throw new Error(`取り込めませんでした: ${JSON.stringify(result.issues)}`);
  return result;
}

const warningsOf = (result: AiImportResult) => result.issues.filter((issue) => issue.severity === 'warning');
const errorsOf = (result: AiImportResult) => result.issues.filter((issue) => issue.severity === 'error');

describe('id の付いた予定は、登録済みの予定を直す指示として読む', () => {
  it('変えたところだけが変わり、AI に渡していないものは引き継ぐ', () => {
    const notices = [
      { id: 'n0', label: '振込データ作成', timing: { kind: 'offset', offset: -5, unit: 'business' } },
      { id: 'n1', label: '支払確認', timing: { kind: 'offset', offset: 1, unit: 'business' } },
    ];
    const { rules, updates } = expectOk(validateAiImport(file([edited({ notices })]), ctx));
    expect(rules).toEqual([]);
    const [update] = updates;
    expect(update?.changed).toBe(true);
    expect(update?.stale).toBe(false);
    const after = update?.after as Rule;
    expect(after.id).toBe('pay');
    expect(after.notices[0]?.timing).toEqual({ kind: 'offset', offset: -5, unit: 'business' });
    // メモ・一時停止・除外日・作成日時は AI に渡していないので、そのまま。
    expect(after.note).toBe('取引先A社');
    expect(after.enabled).toBe(false);
    expect(after.skipDates).toEqual(['2026-12-25']);
    expect(after.createdAt).toBe(payment.createdAt);
    expect(after.updatedAt).toBe('2026-10-15T00:00:00.000Z');
  });

  it('前後予定の id は、元にあるものだけ引き継ぎ、新しいものには重ならない id を振る', () => {
    const notices = [
      { id: 'n1', label: '支払確認', timing: { kind: 'offset', offset: 2, unit: 'business' } },
      { id: 'n9', label: '承認', timing: { kind: 'offset', offset: -5, unit: 'business' } },
      { label: '証憑の保管', timing: { kind: 'offset', offset: 3, unit: 'business' } },
    ];
    const after = expectOk(validateAiImport(file([edited({ notices })]), ctx)).updates[0]?.after as Rule;
    const ids = after.notices.map((notice) => notice.id);
    expect(ids[0]).toBe('n1');
    // 消した n0 の id を別の予定へ回さない。知らない id（n9）は使わない。
    expect(ids).not.toContain('n0');
    expect(ids).not.toContain('n9');
    expect(new Set(ids).size).toBe(3);
  });

  it('省いた項目はそのまま。空文字や期間の null で消せる', () => {
    const keep = expectOk(
      validateAiImport(file([{ id: 'pay', rev: ruleRevision(payment), title: '支払', recurrence: payment.recurrence, adjust: payment.adjust }]), ctx),
    ).updates[0];
    expect(keep?.changed).toBe(false);

    const cleared = expectOk(validateAiImport(file([edited({ group: '', note: '' })]), ctx)).updates[0]?.after as Rule;
    expect(cleared).not.toHaveProperty('group');
    expect(cleared).not.toHaveProperty('note');
  });

  it('何も変わらないものは「変更なし」として扱う', () => {
    const result = validateAiImport(file([edited({})]), ctx);
    const [update] = expectOk(result).updates;
    expect(update?.changed).toBe(false);
    expect(update?.after).toBe(payment);
    // 写して返された一時停止の印は、黙って読み飛ばす。
    expect(result.issues).toEqual([]);
  });

  it('渡したあとでアプリ側が変わっていたら、警告して知らせる', () => {
    const result = validateAiImport(file([edited({ rev: '00000000', title: '支払（本社）' })]), ctx);
    expect(expectOk(result).updates[0]?.stale).toBe(true);
    expect(warningsOf(result)[0]?.message).toContain('アプリ側で変更されています');
  });

  it('rev が無ければ、確かめられないことを知らせる', () => {
    const { rev: _rev, ...withoutRev } = edited({ title: '支払（本社）' });
    const result = validateAiImport(file([withoutRev]), ctx);
    expect(expectOk(result).updates[0]?.stale).toBe(false);
    expect(warningsOf(result)[0]?.path).toBe('rules[0].rev');
  });

  it('知らない id はエラー（新しい予定として足したり、別の予定を直したりしない）', () => {
    const result = validateAiImport(file([{ ...edited({}), id: 'made-up' }]), ctx);
    expect(result.ok).toBe(false);
    expect(errorsOf(result)[0]?.message).toContain('アプリに見つかりません');
    expect(errorsOf(result)[0]?.fix).toContain('新しく作る予定には "id" を付けないでください');
  });

  it('同じ予定を2回直す指示はエラー', () => {
    const result = validateAiImport(file([edited({ title: 'A' }), edited({ title: 'B' })]), ctx);
    expect(result.ok).toBe(false);
    expect(errorsOf(result)[0]?.message).toContain('2つ以上');
  });

  it('id の無い予定は、これまでどおり新しく足す', () => {
    const result = validateAiImport(
      file([{ title: '入金確認', recurrence: { type: 'monthlyByDay', days: ['last'] }, adjust: { mode: 'next' } }]),
      ctx,
    );
    const { rules, updates } = expectOk(result);
    expect(updates).toEqual([]);
    expect(rules[0]?.title).toBe('入金確認');
    expect(existingRules.map((rule) => rule.id)).not.toContain(rules[0]?.id);
  });

  it('新しい予定の前後予定に付いた id は使わない', () => {
    const result = validateAiImport(
      file([
        {
          title: '入金確認',
          recurrence: { type: 'monthlyByDay', days: ['last'] },
          adjust: { mode: 'next' },
          notices: [{ id: 'n0', label: '催促', timing: { kind: 'offset', offset: 3, unit: 'business' } }],
        },
      ]),
      ctx,
    );
    expect(expectOk(result).rules[0]?.notices[0]?.id).toBe('n0');
    expect(warningsOf(result).map((issue) => issue.path)).toEqual(['rules[0].notices']);
  });
});

describe('describeRuleChanges / buildUpdatePreview', () => {
  it('変わった項目だけを、利用者の言葉で並べる', () => {
    const after: Rule = { ...payment, title: '支払（本社）', adjust: { mode: 'next', keepInMonth: false }, group: undefined };
    expect(describeRuleChanges(payment, after, calendars)).toEqual([
      { label: '名前', before: '支払', after: '支払（本社）' },
      { label: 'いつ', before: '毎月25日 / 休業日なら前営業日', after: '毎月25日 / 休業日なら翌営業日' },
      { label: 'グループ', before: '支払・振込', after: '未分類' },
    ]);
  });

  it('変更後の日付は、このアプリで計算する', () => {
    const { updates } = expectOk(validateAiImport(file([edited({ adjust: { mode: 'next' } })]), ctx));
    const [item] = buildUpdatePreview(updates, calendars, scheduleContext, '2026-10-01');
    expect(item?.series[0]?.main.date).toBe('2026-10-26');
    expect(item?.changes.map((change) => change.label)).toEqual(['いつ']);
  });
});

describe('applyAiImport', () => {
  const update = (after: Rule): RuleUpdate => ({ before: payment, after, changed: true, stale: false });

  it('直すものはその場で置き換え、新しいものは後ろへ足す', () => {
    const added = makeRule({ id: 'new', title: '入金確認' });
    const result = applyAiImport(existingRules, [added], [update({ ...payment, title: '支払（本社）' })]);
    expect(result.rules.map((rule) => rule.title)).toEqual(['支払（本社）', '月次締め', '入金確認']);
    expect(result).toMatchObject({ added: 1, updated: 1, missing: [] });
    // ほかのルールは同じ参照のまま。
    expect(result.rules[1]).toBe(closing);
  });

  it('変わらないものには触れない', () => {
    const result = applyAiImport(existingRules, [], [{ before: payment, after: payment, changed: false, stale: false }]);
    expect(result.rules[0]).toBe(payment);
    expect(result.updated).toBe(0);
  });

  it('確認のあいだに別のところで消された予定は、作り直さずに知らせる', () => {
    const result = applyAiImport([closing], [], [update({ ...payment, title: '支払（本社）' })]);
    expect(result.rules).toEqual([closing]);
    expect(result.updated).toBe(0);
    expect(result.missing.map((rule) => rule.id)).toEqual(['pay']);
  });
});
