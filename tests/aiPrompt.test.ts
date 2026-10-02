/**
 * AI への依頼文（docs/SPEC.md §9.5）。
 *
 * 依頼文に書いた形と、取り込みの検証が食い違うと、何度作り直してもらっても
 * 取り込めない。例をそのまま取り込めることまで確かめておく。
 */

import { describe, expect, it } from 'vitest';
import { AI_IMPORT_FORMAT, readAiReply, validateAiImport } from '../src/core/aiImport';
import { buildAiPrompt, buildFixRequest } from '../src/core/aiPrompt';
import { bankCalendarDef, companyCalendarDef } from './helpers';

const calendars = [companyCalendarDef, bankCalendarDef];

describe('buildAiPrompt', () => {
  const prompt = buildAiPrompt(calendars);

  it('形の識別子と版を書く', () => {
    expect(prompt).toContain(`"format": "${AI_IMPORT_FORMAT}"`);
    expect(prompt).toContain('"schemaVersion": 1');
  });

  it('日付を計算させない・黙って決めさせないことを明記する', () => {
    expect(prompt).toContain('具体的な日付を計算しないでください');
    // まとめの表でも日付を書かせない。書くと AI の計算違いを信じさせてしまう。
    expect(prompt).toContain('表の中でも「10月23日」のような日付は書かず');
    expect(prompt).toContain('黙って決めないでください');
  });

  it('利用者に設定の知識を求めず、業務の言葉で聞き取らせる', () => {
    expect(prompt).toContain('利用者は、このアプリで設定できる内容をよく知りません');
    expect(prompt).toContain('設定項目の名前や JSON の話はしないでください');
    // 出す前に、まとめを見せて確かめさせる。
    expect(prompt).toContain('「この内容で作りますか？」と確かめてください');
  });

  it('自分の予定を伝えるだけでなく、業務の相談にも乗らせる', () => {
    expect(prompt).toContain('業務の相談に乗る');
    expect(prompt).toContain('必要になりそうな予定と、その準備・事後確認（前後の予定）を提案します');
    // 法定期限は公式の案内で確かめるよう添えさせる。それらしい期限を作らせない。
    expect(prompt).toContain('公式の案内で確かめてください');
    expect(prompt).toContain('それらしい期限を作らないでください');
  });

  it('会社の決算月を伝える', () => {
    expect(prompt).toContain('この会社の決算月はアプリの設定では 3月 です');
    const september = buildAiPrompt([{ ...companyCalendarDef, fiscalYearEndMonth: 9 }, bankCalendarDef]);
    expect(september).toContain('決算月はアプリの設定では 9月 です');
  });

  it('既に使っているグループ名を伝える（無ければ触れない）', () => {
    expect(prompt).not.toContain('既に使っているグループ');
    const withGroups = buildAiPrompt({ calendars, groups: ['税務', '支払・振込', '税務', ''] });
    expect(withGroups).toContain('利用者が既に使っているグループ: 「税務」、「支払・振込」。');
  });

  it('最後に、利用者へ話しかけるところから始めさせる', () => {
    expect(prompt.trimEnd().endsWith('「進め方」の1のとおり利用者に話しかけてください。')).toBe(true);
  });

  it('手元の営業日カレンダーを選べる値として示す', () => {
    expect(prompt).toContain('"company" … 自社カレンダー');
    expect(prompt).toContain('"bank" … 銀行休業日');
  });

  it('使える値を示す', () => {
    for (const value of ['monthlyByDay', 'monthlyByWeekday', 'monthlyByBusinessDay', 'weekly', 'fiscalRelative']) {
      expect(prompt).toContain(`"${value}"`);
    }
    for (const value of ['"none"', '"prev"', '"next"', '"nearest"', '"both"']) {
      expect(prompt).toContain(value);
    }
  });

  it('依頼文の例は、そのまま取り込める', () => {
    // 依頼文をそのまま貼り返されたとしても、例の JSON（コードブロック1つ）だけが候補になる。
    const result = readAiReply(prompt, { calendars });
    expect(result.ok).toBe(true);
  });

  it('依頼文の例は、検証を警告なしで通る', () => {
    const block = /```json\n([\s\S]*?)```/.exec(prompt)?.[1] ?? '';
    const result = validateAiImport(JSON.parse(block), { calendars });
    expect(result).toMatchObject({ ok: true, issues: [] });
  });

  it('手元のデータはカレンダー名以外を含めない', () => {
    // ルールの中身などは渡さない。引数としても受け取らない。
    expect(buildAiPrompt([{ id: 'x', name: '本社' }])).toContain('"x" … 本社');
  });
});

describe('buildFixRequest', () => {
  it('AI 向けの直し方を並べる', () => {
    const result = readAiReply(
      JSON.stringify({
        format: AI_IMPORT_FORMAT,
        schemaVersion: 1,
        rules: [{ title: '支払', recurrence: { type: 'monthlyByDay', days: [25] }, adjust: { mode: 'previousBusinessDay' } }],
      }),
      { calendars },
    );
    expect(result.ok).toBe(false);
    const text = buildFixRequest(result.issues);
    expect(text).toContain('Business Days Schedule で読み込めませんでした');
    expect(text).toContain('rules[0].adjust.mode は "none" / "prev" / "next" / "nearest" / "both" のいずれかにしてください');
    expect(text).toContain('具体的な日付は計算せず');
  });

  it('JSON を取り出せなかったときも依頼文を作れる', () => {
    const result = readAiReply('すみません、もう少し詳しく教えてください。', { calendars });
    expect(result.ok).toBe(false);
    expect(buildFixRequest(result.issues)).toContain('```json コードブロックで出力してください');
  });
});
