/**
 * AI への依頼文（docs/SPEC.md §9.5）。
 *
 * 依頼文に書いた形と、取り込みの検証が食い違うと、何度作り直してもらっても
 * 取り込めない。例をそのまま取り込めることまで確かめておく。
 */

import { describe, expect, it } from 'vitest';
import { AI_IMPORT_FORMAT, readAiReply, validateAiImport } from '../src/core/aiImport';
import { buildSharedData, defaultShareOptions } from '../src/core/aiContext';
import type { AiPurpose } from '../src/core/aiContext';
import { buildAiPrompt, buildFixRequest } from '../src/core/aiPrompt';
import { bankCalendarDef, companyCalendarDef, makeRule, scheduleContext } from './helpers';

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

describe('buildAiPrompt: 頼むことと渡す登録内容', () => {
  const rules = [
    makeRule({
      id: 'pay',
      title: '支払',
      calendarId: 'bank',
      note: '取引先A社',
      recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
      adjust: { mode: 'prev', keepInMonth: false },
    }),
  ];
  const promptFor = (purpose: AiPurpose, overrides: Partial<ReturnType<typeof defaultShareOptions>> = {}) =>
    buildAiPrompt({
      calendars,
      purpose,
      shared: buildSharedData({ rules, calendars }, { ...defaultShareOptions(purpose), ...overrides }, scheduleContext, '2026-10-15'),
    });

  it('既定（新しく作る・何も渡さない）は、これまでの依頼文と同じ', () => {
    expect(promptFor('create')).toBe(buildAiPrompt({ calendars }));
  });

  it('頼むことごとに、役割と進め方を変える', () => {
    expect(promptFor('revise')).toContain('「どの予定を、どう直したいですか？」');
    expect(promptFor('review')).toContain('点検した結果を重要なものから表');
    expect(promptFor('review')).toContain('問題を作らないでください');
    expect(promptFor('handover')).toContain('引き継ぎ資料を作る');
    expect(promptFor('question')).toContain('「予定について、何を知りたいですか？」');
    // どれも日付を計算させない決まりは同じ。
    for (const purpose of ['revise', 'review', 'handover', 'question'] as const) {
      expect(promptFor(purpose)).toContain('具体的な日付を計算しないでください');
      expect(promptFor(purpose).trimEnd().endsWith('「進め方」の1のとおり利用者に話しかけてください。')).toBe(true);
    }
  });

  it('登録済みの予定は1行に1件で渡し、直し方の決まりを添える', () => {
    const prompt = promptFor('revise');
    expect(prompt).toContain('## 登録済みの予定（1 件。');
    expect(prompt).toContain('"id":"pay"');
    expect(prompt).toContain('"id" と "rev" をそのまま写し');
    expect(prompt).toContain('変えない予定は出力しないでください');
    expect(prompt).toContain('予定を消すことはできません');
    // メモは選ばなければ渡さない。
    expect(prompt).not.toContain('取引先A社');
    expect(prompt).toContain('メモは渡していません');
    expect(promptFor('revise', { notes: true })).toContain('取引先A社');
  });

  it('予定を渡さなければ、直し方の決まりも入れない', () => {
    expect(promptFor('create')).not.toContain('登録済みの予定を直すとき');
    expect(promptFor('revise', { rules: false })).toContain('登録済みの予定は渡されていません');
  });

  it('予定の一覧を渡すときは、一覧の日付だけを使わせる', () => {
    const prompt = promptFor('question');
    expect(prompt).toContain('## 予定の一覧（2026-10-01〜2026-12-31。アプリが営業日カレンダーで計算した日付');
    expect(prompt).toContain('2026-10-23（金） 支払（本来は 2026-10-25（日）。休業日のため前へ）');
    expect(prompt).toContain('「予定の一覧」（アプリが計算したもの）にある日付だけを使ってください');
    expect(prompt).not.toContain('表の中でも「10月23日」のような日付は書かず');
  });

  it('依頼文を貼り返されても、渡した登録内容を設定データと取り違えない', () => {
    const prompt = promptFor('handover');
    const result = readAiReply(prompt, { calendars, existingRules: rules });
    // 候補になるのは例の JSON だけ（新しい予定として読める）。
    expect(result).toMatchObject({ ok: true, updates: [] });
  });

});

describe('buildAiPrompt: 回答の受け取り方', () => {
  it('ファイルで受け取るときは、JSON ファイルを頼み、作れなければコードブロックで出させる', () => {
    const prompt = buildAiPrompt({ calendars, replyAs: 'file' });
    expect(prompt).toContain('JSON ファイル（例: business-days-schedule.json）として出力してください');
    expect(prompt).toContain('ファイルを作れない場合は、```json のコードブロック1つにまとめてください');
    expect(prompt).toContain('〈AIの回答を取り込む〉の〈ファイルから読み込む〉で選んでください');
    expect(prompt).not.toContain('この回答をそのまま貼ってください');
  });

  it('既定は貼り付けで受け取る', () => {
    expect(buildAiPrompt({ calendars })).toContain('〈AIの回答を取り込む〉に、この回答をそのまま貼ってください');
    expect(buildAiPrompt({ calendars, replyAs: 'paste' })).toBe(buildAiPrompt({ calendars }));
  });

  it('ファイルで頼んでも、例はそのまま取り込める', () => {
    expect(readAiReply(buildAiPrompt({ calendars, replyAs: 'file' }), { calendars }).ok).toBe(true);
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
    expect(text).toContain('rules[0].adjust.mode は "none" / "prev" / "next" / "nearest" / "both" / "skip" のいずれかにしてください');
    expect(text).toContain('具体的な日付は計算せず');
  });

  it('JSON を取り出せなかったときも依頼文を作れる', () => {
    const result = readAiReply('すみません、もう少し詳しく教えてください。', { calendars });
    expect(result.ok).toBe(false);
    expect(buildFixRequest(result.issues)).toContain('```json コードブロックで出力してください');
  });
});
