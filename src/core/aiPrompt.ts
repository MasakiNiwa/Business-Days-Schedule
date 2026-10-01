/**
 * 外部 AI に渡す依頼文（docs/SPEC.md §9.5）。
 *
 * 利用者はこれをコピーして自分の AI に貼り、続けて作りたい予定を普通の言葉で
 * 伝える。AI には「ルールを決まった形の JSON にする」ことだけを頼み、
 * 日付は計算させない。何日になるかは、このアプリの営業日計算が決める。
 *
 * 書く内容は src/core/aiImport.ts の検証と揃える。ここで許した値を
 * 検証が弾くと、利用者は何度作り直してもらっても取り込めない。
 */

import type { BusinessCalendar } from '../types';
import {
  AI_COLORS,
  AI_IMPORT_FORMAT,
  AI_IMPORT_LIMITS,
  AI_IMPORT_SCHEMA_VERSION,
  MAX_BUSINESS_NTH,
} from './aiImport';
import type { AiImportIssue } from './aiImport';
import { LIMITS } from './validate';

const EXAMPLE = {
  format: AI_IMPORT_FORMAT,
  schemaVersion: AI_IMPORT_SCHEMA_VERSION,
  rules: [
    {
      title: '支払',
      calendarId: 'bank',
      recurrence: { type: 'monthlyByDay', days: [25] },
      adjust: { mode: 'prev' },
      notices: [
        { label: '振込データ作成', timing: { kind: 'offset', offset: -3, unit: 'business' } },
        { label: '支払確認', timing: { kind: 'offset', offset: 1, unit: 'business' } },
      ],
    },
  ],
};

/**
 * 依頼文を作る。
 *
 * 利用者の手元にある営業日カレンダーの id と名前だけを埋め込む。
 * ルールの中身や日付など、それ以外の手元のデータは渡さない。
 */
export function buildAiPrompt(calendars: readonly Pick<BusinessCalendar, 'id' | 'name'>[]): string {
  const calendarLines = calendars.map((calendar) => `  - "${calendar.id}" … ${calendar.name}`).join('\n');
  return `あなたは、予定管理アプリ「Business Days Schedule」の設定を作るアシスタントです。
このあと私が、作りたい繰り返し予定を普通の言葉で説明します。それを、下の決まりに沿った設定データ（JSON）に変換してください。

# いちばん大事な決まり
- 具体的な日付を計算しないでください。「毎月25日、休業日なら前営業日」と言われたら、何日になるかを求めず、そのルール自体を設定データにしてください。日付の計算は、祝日や会社の休業日を知っているアプリ側が行います。
- 私の説明から決められないこと（休業日にあたったときの扱い、どの営業日カレンダーで数えるか、など）は、勝手に補わず、設定データを出す前に私に質問してください。
- 下に書いていない項目や値は使わないでください。表せない予定があれば、無理に近いものへ置き換えず、表せないと伝えてください。

# 出力のしかた
- 設定データは \`\`\`json のコードブロック1つにまとめてください。予定が複数あっても、1つの JSON の "rules" に並べます。
- 一度に作る予定は ${AI_IMPORT_LIMITS.rules} 件までです。
- コードブロックの外に短い説明を書いてもかまいません。

# 設定データの形
{
  "format": "${AI_IMPORT_FORMAT}",   … 必ずこの文字列
  "schemaVersion": ${AI_IMPORT_SCHEMA_VERSION},                                … 必ずこの数値
  "rules": [ 予定, ... ]
}

## 予定（rules の要素）
- "title"（必須）: 予定の名前。${LIMITS.titleLength}文字以内、改行なし
- "calendarId"（省略可）: 営業日をどのカレンダーで数えるか。次のどれか。省略すると最初のもの
${calendarLines}
  銀行の営業日に従う予定（振込・入金など）は銀行のカレンダーを選ぶのが一般的です
- "recurrence"（必須）: 繰り返し方。下の5種類のどれか
- "adjust"（必須。第N営業日のときは省略）: 本来の日が休業日にあたったときの扱い
- "notices"（省略可）: 本体に付ける前後の予定（準備日・確認日など）の配列。1件の予定につき ${LIMITS.notices} 件まで
- "group"（省略可）: 「支払」「税務」のような束ねる名前。${LIMITS.groupLength}文字以内
- "note"（省略可）: メモ。${LIMITS.noteLength}文字以内
- "color"（省略可）: ${AI_COLORS.map((color) => `"${color}"`).join(' / ')}
- "period"（省略可）: 有効期間 { "start": "YYYY-MM-DD" または null, "end": "YYYY-MM-DD" または null }。利用者が期間を言ったときだけ

## recurrence（繰り返し方）
曜日の番号は 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土。
"interval" は省略すると 1（毎月・毎週）。2 なら隔月・隔週。
"months" は対象の月（1〜12）を絞るときだけ。例: 四半期末なら [3, 6, 9, 12]、毎年4月なら [4]。

1. 毎月N日・月末
   { "type": "monthlyByDay", "days": [25], "interval": 1, "months": [...], "overflow": "clamp" }
   - "days": 1〜31 の整数、または "last"（末日）。例: [10, 25]、["last"]
   - "overflow": 2月30日のように存在しない日の扱い。"clamp"（末日にする。既定）/ "skip"（その月は無し）

2. 毎月第N曜日
   { "type": "monthlyByWeekday", "nth": [2], "weekday": 2 }
   - "nth": 1〜5、または -1（最終）。例: 第2・第4なら [2, 4]
   - "weekday": 0〜6

3. 毎月第N営業日・月末からN営業日前
   { "type": "monthlyByBusinessDay", "nth": [3] }
   - "nth": 1〜${MAX_BUSINESS_NTH} は月初から（1 が第1営業日）、-1〜-${MAX_BUSINESS_NTH} は月末から（-1 が最終営業日、-3 が月末から3営業日目）
   - 必ず営業日になるので "adjust" は不要です

4. 毎週・隔週
   { "type": "weekly", "weekdays": [1], "interval": 1, "anchor": "YYYY-MM-DD" }
   - "weekdays": 0〜6 の配列
   - "anchor": 隔週など interval が 2 以上のとき、繰り返しの起点となる週の日付。分からなければ私に尋ねてください

5. 決算月を基準にした日（税務の申告期限など）
   { "type": "fiscalRelative", "offsetMonths": [2], "day": "last" }
   - "offsetMonths": 決算月からのずれ（-24〜24）。0=決算月、2=決算月の2か月後、-11=期首の月
   - "day": 1〜31 または "last"
   - 決算月そのものはアプリ側の設定を使います

## adjust（休業日にあたったときの扱い）
{ "mode": "prev", "keepInMonth": false }
- "mode": "none"（動かさない）/ "prev"（前営業日へ）/ "next"（翌営業日へ）/ "nearest"（近いほうの営業日へ）/ "both"（前と後の両方に出す）
- "keepInMonth"（省略可。既定 false）: true にすると、動かした先が別の月になるときは逆向きに動かして同じ月に収めます

## notices（前後の予定）
{ "label": "振込データ作成", "timing": { ... } }
"timing" は次の3種類のどれか。起点は、休業日の扱いで動かしたあとの本体の日です。
1. 本体の何日前・何日後
   { "kind": "offset", "offset": -3, "unit": "business" }
   - "offset": 負の数は前、正の数は後（0 は不可）。-${LIMITS.noticeOffset}〜${LIMITS.noticeOffset}
   - "unit": "business"（営業日で数える）/ "calendar"（暦日で数える）
2. 本体の週から数えた曜日（週は月曜始まり）
   { "kind": "weekday", "weeks": 1, "weekday": 3, "onClosed": "next" }
   - "weeks": -1=前週、0=同じ週、1=翌週（-${LIMITS.noticeWeeks}〜${LIMITS.noticeWeeks}）
   - "onClosed": その日が休業日のとき "next"（翌営業日へ）/ "prev"（前営業日へ）/ "none"（動かさない）
3. 本体の月から数えた第N営業日
   { "kind": "monthlyBusinessDay", "months": 1, "nth": 5 }
   - "months": 0=同じ月、1=翌月、-1=前月（-${LIMITS.noticeMonths}〜${LIMITS.noticeMonths}）
   - "nth": 1〜${LIMITS.noticeNth} は月初から、-1〜-${LIMITS.noticeNth} は月末から（0 は不可）

# 例
説明: 「毎月25日が支払日。休みなら前営業日。3営業日前に振込データを作成して、翌営業日に支払確認。」
\`\`\`json
${JSON.stringify(EXAMPLE, null, 2)}
\`\`\`

準備ができたら「どんな予定を作りますか？」とだけ答えて、私の説明を待ってください。`;
}

/**
 * 読み込めなかったときに、AI へ直してもらうための依頼文。
 *
 * 利用者に JSON を直させるのではなく、作った AI に直してもらう。
 * 何がいけなかったのかを、項目名と使える値まで含めて伝える。
 */
export function buildFixRequest(issues: readonly AiImportIssue[]): string {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const lines = (errors.length > 0 ? errors : issues).map((issue) => `- ${issue.fix}`);
  return `Business Days Schedule で読み込めませんでした。次の点を直して、修正後の設定データ全体を \`\`\`json のコードブロック1つでもう一度出力してください。
具体的な日付は計算せず、ルールのまま出力してください。直し方が私の説明から決められない場合は、勝手に補わずに私に質問してください。

${lines.join('\n')}`;
}
