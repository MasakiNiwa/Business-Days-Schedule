/**
 * ヘルプ。
 *
 * このアプリの肝は「反復ルール」と「営業日補正」で、どちらも一般的なカレンダーには
 * 無い概念のため、画面内で説明できる場所を用意する。
 */

import { button } from './controls';
import { h } from './dom';

type Row = { term: string; body: string };

const RECURRENCE_ROWS: Row[] = [
  { term: '毎月N日', body: '毎月25日、毎月10日と25日、毎月末日。複数の日をまとめて指定できます。' },
  { term: '第N営業日', body: '毎月第5営業日、月末から2営業日前。休業日を数えずに数えるので、補正は行われません。' },
  { term: '第N曜日', body: '第2・第4火曜、最終金曜。第5週が無い月を飛ばしたくなければ「最終」を選びます。' },
  { term: '毎週', body: '毎週金曜、隔週月曜。隔週は基準日を起点に数えます。' },
];

const ADJUST_ROWS: Row[] = [
  { term: '前営業日へ', body: '給与振込や締め処理のように、期日より後にずれては困るもの。' },
  { term: '翌営業日へ', body: '納付期限のように、休業日なら翌営業日が期日になるもの。' },
  { term: '近い方の営業日へ', body: '前後どちらでもよいもの。距離が同じときは前倒しを選びます。' },
  {
    term: '前後の営業日の両方',
    body: '取引先ごとに前倒し・後ろ倒しが分かれるとき。1つの基準日から前後2件が表示され、それぞれ ← → で区別できます。',
  },
  { term: '補正しない', body: '休業日でもその日のまま表示します。' },
];

const MARK_ROWS: Row[] = [
  { term: '←10', body: '本来10日の予定が、10日が休業日のため前の営業日へ移動してきたもの。' },
  { term: '→10', body: '本来10日の予定が、10日が休業日のため次の営業日へ移動してきたもの。' },
  { term: '破線の枠', body: '事前通知（準備日）。本体の予定から遡って表示されます。' },
  { term: '＋N件', body: 'その日に入り切らなかった予定。クリックすると当日の一覧が開きます。' },
];

function section(title: string, rows: Row[], lead?: string): HTMLElement {
  return h(
    'section',
    { class: 'editor-section' },
    h('h3', { class: 'editor-heading' }, title),
    lead === undefined ? null : h('p', { class: 'field-hint' }, lead),
    h(
      'dl',
      { class: 'help-list' },
      ...rows.flatMap((row) => [h('dt', {}, row.term), h('dd', {}, row.body)]),
    ),
  );
}

export function renderHelp(onClose: () => void): HTMLElement {
  return h(
    'section',
    { class: 'help' },
    h('h2', { class: 'editor-title' }, 'ヘルプ'),
    h(
      'p',
      { class: 'field-hint' },
      'このカレンダーは、日付を1件ずつ登録するのではなく、繰り返しの決まりごと（ルール）から予定を導き出します。休祝日にあたった予定は、ルールごとの指定にしたがって営業日へ自動で移動します。',
    ),
    section('繰り返しの種類', RECURRENCE_ROWS),
    section('休業日にあたったとき', ADJUST_ROWS),
    section('カレンダーの記号', MARK_ROWS),
    section(
      '営業日カレンダー',
      [
        { term: '自社 / 銀行', body: '別々に持てます。社内の締めは自社、振込は銀行、と使い分けられます。' },
        { term: '週の休業日', body: '土曜出勤なら土を外します。' },
        { term: '毎年の休業期間', body: '年末年始や夏季休業。12-29 〜 01-03 のように年をまたぐ指定もできます。' },
        { term: '休業日だが営業する日', body: '祝日出勤など。他のどの条件よりも優先されます。' },
      ],
      '設定から編集できます。変更すると営業日数とカレンダーがその場で更新されます。',
    ),
    section(
      'サンプル',
      [
        { term: '追加できる型', body: '基本セット・税務・届出／売上・入金／支払・振込／会議・報告。使い始めたあとでも足せます。' },
        { term: '追加のしかた', body: 'ルール一覧の「サンプルを追加」から。既にあるルールは消えません。' },
        { term: '再追加', body: '同じ束をもう一度追加すると、その束のルールだけが元の内容へ戻ります。' },
      ],
      '日付や名称は目安です。自社の運用に合わせて直してください。',
    ),
    section('データの保存', [
      { term: '保存先', body: 'この端末のブラウザ（localStorage）に保存されます。サーバーへは送られません。' },
      { term: 'バックアップ', body: '設定の「エクスポート」で JSON に書き出せます。端末を移るときに使ってください。' },
      {
        term: '外部カレンダーへ',
        body: '設定から、期間を指定して iCalendar (.ics) または CSV で書き出せます。Google カレンダーや Outlook に取り込めます。繰り返しの設定そのものは渡らず、その期間の日付として展開されるので、期間が過ぎたら書き出し直してください。',
      },
      { term: '祝日データ', body: '毎週自動更新されます。出典と取得日時は設定で確認できます。' },
    ]),
    h('div', { class: 'editor-actions' }, button('閉じる', onClose, 'button button-primary')),
  );
}
