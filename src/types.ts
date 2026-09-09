/**
 * アプリ全体で共有する型定義。
 * 仕様の対応箇所は docs/SPEC.md §4, §5。
 */

/** ISO 8601 の日付部分のみ。常に "YYYY-MM-DD" 形式で保持する（docs/SPEC.md §7.3）。 */
export type DateStr = string;

/** "MM-DD" 形式。年をまたぐ休業期間の指定に使う。 */
export type MonthDayStr = string;

/** 0 = 日曜 … 6 = 土曜。JavaScript の getUTCDay() と同じ並び。 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 1 = 1月 … 12 = 12月。 */
export type Month = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** 第N曜日の N。-1 は「最終」。 */
export type NthWeekday = 1 | 2 | 3 | 4 | 5 | -1;

export type ColorToken =
  | 'blue'
  | 'green'
  | 'red'
  | 'orange'
  | 'purple'
  | 'teal'
  | 'pink'
  | 'gray';

// ---------------------------------------------------------------------------
// 祝日データ (docs/SPEC.md §3.3)
// ---------------------------------------------------------------------------

export type HolidayMeta = {
  source: string;
  sourceUrl: string;
  sourceSha: string | null;
  fetchedAt: string;
  range: { from: DateStr; to: DateStr };
  count: number;
};

export type HolidayData = {
  meta: HolidayMeta;
  /** "YYYY-MM-DD" → 祝日名 */
  holidays: Record<DateStr, string>;
};

// ---------------------------------------------------------------------------
// 営業日カレンダー (docs/SPEC.md §4)
// ---------------------------------------------------------------------------

/** 毎年繰り返す休業期間。from > to のときは年をまたぐ（例 12-29 〜 01-03）。 */
export type AnnualRange = {
  from: MonthDayStr;
  to: MonthDayStr;
  label: string;
};

export type BusinessCalendar = {
  id: string;
  name: string;
  /**
   * 決算月（事業年度の終わる月）。未設定なら3月とみなす。
   * 「決算日から2か月後」のような、会計年度を基準にした予定の起点になる。
   */
  fiscalYearEndMonth?: Month;
  /** 週末として休業扱いにする曜日。既定は [0, 6]。 */
  weekendDays: Weekday[];
  useNationalHolidays: boolean;
  closedRanges: AnnualRange[];
  /** 臨時休業日。 */
  closedDates: DateStr[];
  /** 休業日だが営業する日。他のどの条件よりも優先される。 */
  openDates: DateStr[];
};

// ---------------------------------------------------------------------------
// 反復条件 (docs/SPEC.md §5.2)
// ---------------------------------------------------------------------------

/** 毎週 / 隔週。 */
export type WeeklyRecurrence = {
  type: 'weekly';
  interval: number;
  weekdays: Weekday[];
  /** interval >= 2 のときの位相基準。省略時は period.start、それも無ければ既定値を使う。 */
  anchor?: DateStr;
};

/** 毎月N日 / 月末。months を絞れば年次・四半期になる。 */
export type MonthlyByDayRecurrence = {
  type: 'monthlyByDay';
  interval: number;
  months?: Month[];
  days: (number | 'last')[];
  /** 存在しない日（2月31日など）の扱い。clamp = 末日に丸める / skip = その月は発生させない。 */
  overflow: 'clamp' | 'skip';
};

/** 毎月第N曜日。 */
export type MonthlyByWeekdayRecurrence = {
  type: 'monthlyByWeekday';
  interval: number;
  months?: Month[];
  nth: NthWeekday[];
  weekday: Weekday;
};

/** 毎月第N営業日 / 月末からN営業日前。負値は月末起点。 */
export type MonthlyByBusinessDayRecurrence = {
  type: 'monthlyByBusinessDay';
  interval: number;
  months?: Month[];
  nth: number[];
};

/**
 * 決算月を起点にした反復。
 *
 * 決算月の末日を基準日とし、そこから offsetMonths か月ずらした月の day 日に発生する。
 * 決算月を変えるだけで、申告期限・期首・中間申告・四半期がまとめて追従する。
 */
export type FiscalRelativeRecurrence = {
  type: 'fiscalRelative';
  /** 決算月からのずれ（月数）。0 = 決算月、2 = 決算月の2か月後、-11 = 期首月。 */
  offsetMonths: number[];
  /** ずらした先の月の何日か。存在しない日は末日に丸める。 */
  day: number | 'last';
};

export type Recurrence =
  | WeeklyRecurrence
  | MonthlyByDayRecurrence
  | MonthlyByWeekdayRecurrence
  | MonthlyByBusinessDayRecurrence
  | FiscalRelativeRecurrence;

// ---------------------------------------------------------------------------
// 営業日補正・事前通知・ルール (docs/SPEC.md §5.3 - §5.5)
// ---------------------------------------------------------------------------

/**
 * both … 休業日なら前営業日と翌営業日の両方に表示する。
 *        取引先ごとに前倒し・後ろ倒しが分かれる入金予定などを、1つのルールで扱うため。
 */
export type AdjustMode = 'none' | 'prev' | 'next' | 'nearest' | 'both';

export type Adjustment = {
  mode: AdjustMode;
  /** true のとき、補正が月をまたぐ場合は逆方向へ補正し直す。 */
  keepInMonth: boolean;
};

/** 事前通知（準備日）。offset は負値のみ。 */
/**
 * 前後予定の「日付の決め方」（docs/SPEC.md §5.4）。
 *
 * 決め方だけを差し替えられるよう、識別子（id）・名称（label）とは分けて持つ。
 * 決め方を変えても同じ予定でいられるようにするため。
 */
export type NoticeTiming =
  /** 本体から何日か。負なら前、正なら後。0 は本体と同じ日なので認めない。 */
  | { kind: 'offset'; offset: number; unit: 'business' | 'calendar' }
  /**
   * 本体の属する週から数えた、指定の曜日。
   * 「金曜締め → 翌週水曜に報告書提出」のような、暦の週で回る仕事のため。
   */
  | {
      kind: 'weekday';
      /** -1 = 前週、0 = 同じ週、1 = 翌週。週は月曜始まり。 */
      weeks: number;
      weekday: Weekday;
      /** その曜日が休業日だったとき。'none' はそのままの日に置く。 */
      onClosed: 'next' | 'prev' | 'none';
    }
  /**
   * 本体の属する月から数えた、第N営業日。
   * 「月末締め → 翌月第5営業日に請求書発行」のような、月で回る仕事のため。
   */
  | {
      kind: 'monthlyBusinessDay';
      /** 0 = 同じ月、1 = 翌月。 */
      months: number;
      /** 正 = 月初から（1 が第1営業日）、負 = 月末から（-1 が最終営業日）。 */
      nth: number;
    };

/** 本体より前に置くつもりか、後ろに置くつもりか。 */
export type NoticeRole = 'before' | 'after';

/**
 * 本体の予定に紐づく、前後の予定（docs/SPEC.md §5.4）。
 *
 * 「振込データは3営業日前に作る」も「入金は5営業日後に消し込む」も、
 * 同じ1つのルールにぶら下げられる。別のルールとして作らせると、
 * 本体の日付が動いたときに片方だけ取り残される。
 *
 * `timing` が日付の決め方。古いデータは `offset`/`unit` を直に持っているので、
 * 読み込みの時点で `{ kind: 'offset' }` へ均す（src/core/notice.ts）。
 */
export type Notice = {
  /**
   * この前後予定を指す固定の識別子。外部カレンダーの UID に使う。
   *
   * 配列の順番を使っていたため、1件消すと残りの識別子がずれ、消したものの
   * 識別子を引き継いでしまっていた（取り込み先で別予定と取り違えられる）。
   *
   * 省略された古いデータは、読み込み時に今の順番から `n0`, `n1`, … を割り当てる。
   * こうすると、既に書き出したぶんの UID が変わらない。
   */
  id?: string;
  label: string;
  timing?: NoticeTiming;
  /**
   * 本体の前・後どちらのつもりか。日数指定では符号から決まるので省略できる。
   * 週や月で決めると前後が入れ替わりうるので、そのときは意図として持ち、
   * 実際の日付が食い違ったら警告に出す。
   */
  role?: NoticeRole;
  /** @deprecated 旧形式。読み込み時に timing へ均す。 */
  offset?: number;
  /** @deprecated 旧形式。読み込み時に timing へ均す。 */
  unit?: 'business' | 'calendar';
};

export type Rule = {
  id: string;
  title: string;
  color: ColorToken;
  /**
   * 所属するグループ。空文字と未設定は「未分類」とみなす。
   *
   * 実務では「税務」「入金」「社内」のように束で見たい・束で渡したいことが多い。
   * 独立した実体にせず文字列にしているのは、名前を変えるだけで束ね直せるほうが
   * 使い始めやすく、消えたグループを別途片付ける必要も無いため。
   */
  group?: string;
  note?: string;
  enabled: boolean;
  calendarId: string;
  recurrence: Recurrence;
  adjust: Adjustment;
  notices: Notice[];
  period: { start: DateStr | null; end: DateStr | null };
  /** 除外する【基準日】。補正後の日付ではない点に注意。 */
  skipDates: DateStr[];
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// 展開結果 (docs/SPEC.md §7.2)
// ---------------------------------------------------------------------------

export type Occurrence = {
  ruleId: string;
  /** main = 本体、notice = 本体より前の準備日、follow = 本体より後のフォロー。 */
  kind: 'main' | 'notice' | 'follow';
  /** 補正前の基準日。事前通知では、対応する本体の確定日。 */
  rawDate: DateStr;
  /**
   * ルールが生んだ元の日付（営業日補正の前）。事前通知でも本体の基準日を指す。
   * 祝日データが変わっても動かないため、外部カレンダーの UID など
   * 「同じ予定」を identify する用途に使う。
   */
  baseDate: DateStr;
  /** 補正後の確定日。表示に使うのはこちら。 */
  date: DateStr;
  shifted: boolean;
  shiftDirection: 'prev' | 'next' | null;
  /**
   * この発生日が属する系列の向き。本体は自身の shiftDirection と同じ、
   * 準備日・フォローは対応する本体の向きを引き継ぐ。
   *
   * 補正が `both` のとき、1つの基準日から前倒しと後ろ倒しの2系列が生まれる。
   * 子（準備日・フォロー）自身は動いていないので shiftDirection は null になり、
   * これだけでは2系列を見分けられない。外部カレンダーの UID は
   * 「同じ予定かどうか」の判定に使われるため、見分けられないと
   * 書き出す期間によって別の予定へ割り当てが移ってしまう。
   */
  seriesDirection: 'prev' | 'next' | null;
  noticeLabel?: string;
  /** 事前通知が rule.notices の何番目か。UID の一意性に使う。 */
  noticeIndex?: number;
  /** 対応する Notice.id。UID はこれを使う（順番に依存させないため）。 */
  noticeId?: string;
  /**
   * 設定から決まる「本体の前・後どちらのつもりか」。実際に出た日付ではなく
   * 設定で決まる。UID はこちらを使う。kind を使うと、休業日の設定を変えて
   * 前後が入れ替わるたびに同じ予定が別の予定になってしまう。
   */
  noticeRole?: NoticeRole;
  /**
   * 休業日を避ける前に指していた日。避けていなければ未設定。
   * 「水曜が休業日のため木曜へ」と、動いた理由を添えるために持つ。
   */
  noticeMovedFrom?: DateStr;
};

export type DateRange = { start: DateStr; end: DateStr };
