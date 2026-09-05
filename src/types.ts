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
export type Notice = {
  offset: number;
  unit: 'business' | 'calendar';
  label: string;
};

export type Rule = {
  id: string;
  title: string;
  color: ColorToken;
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
  kind: 'main' | 'notice';
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
  noticeLabel?: string;
  /** 事前通知が rule.notices の何番目か。UID の一意性に使う。 */
  noticeIndex?: number;
};

export type DateRange = { start: DateStr; end: DateStr };
