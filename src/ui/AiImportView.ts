/**
 * AI で予定を作る・見直す（docs/SPEC.md §9.5）。
 *
 * 1. 頼むこと（作る・直す・点検・引き継ぎ資料・質問）と、AI に渡す登録内容を選び、
 *    組み立てた依頼文をコピーして、利用者が自分の AI に貼る
 * 2. AI と話す
 * 3. 返ってきた回答をここへ貼る → 確認（直すものは変更前と変更後）→ 登録
 *
 * 登録内容を渡すかどうかは利用者が選ぶ。既定では、頼むことに必要なものだけを入れ、
 * メモは入れない。何をどれだけ渡すかは、コピーする前に画面で見せる。
 *
 * このアプリから AI へは通信しない。回答は信用できない外部入力として
 * src/core/aiImport.ts で確かめ、日付はこのアプリの営業日計算で出して見せる。
 * 登録は〈この内容で登録〉を押したときだけ。
 */

import {
  AI_PURPOSES,
  buildSharedData,
  defaultShareOptions,
  OCCURRENCE_MONTH_CHOICES,
} from '../core/aiContext';
import type { AiPurpose, AiShareOptions } from '../core/aiContext';
import {
  AI_IMPORT_LIMITS,
  buildImportPreview,
  buildUpdatePreview,
  readAiReply,
} from '../core/aiImport';
import type { AiImportIssue, ImportPreviewItem, RuleUpdate, UpdatePreviewItem } from '../core/aiImport';
import { AI_REQUEST_LIMIT, buildAiPrompt, buildFixRequest } from '../core/aiPrompt';
import { collectGroups } from '../core/group';
import type { ScheduleContext } from '../core/schedule';
import type { BusinessCalendar, Rule } from '../types';
import { button, checkbox, field, select } from './controls';
import { clear, h, scrollIntoView } from './dom';
import { renderPreviewList } from './previewList';

export type AiImportHandlers = {
  /** クリップボードへ写す。写せなければ false（その場で選んでコピーしてもらう）。 */
  copyText: (text: string) => Promise<boolean>;
  /** 新しく足すルールと、直すルール（変わるものだけ）。 */
  onRegister: (rules: Rule[], updates: RuleUpdate[]) => void;
  onClose: () => void;
};

type PurposeGuide = {
  label: string;
  /** 選んだときに出す説明。 */
  hint: string;
  /** 手順2の見出しと説明。 */
  talkTitle: string;
  talkHint: string;
  /**
   * 伝え方の例。設定に詳しくない人ほど、何を言えばよいかで止まるため。
   * 「作る」では、自分の予定を伝えるだけでなく業務の相談から始めてもよいことを見せる。
   */
  examples: readonly { label: string; text: string }[];
  /** 最初に伝えることの入力欄の例。 */
  placeholder: string;
  /** 手順3の説明。設定データが返ってくるとは限らない頼みごとで添える。 */
  pasteHint?: string;
  /** 登録済みの予定が無いと頼めないか。 */
  needsRules: boolean;
};

const PURPOSES: Record<AiPurpose, PurposeGuide> = {
  create: {
    label: '新しく作る',
    hint: '作りたい予定を伝えるか、業務に必要な予定を相談して、新しい予定を作ります。',
    talkTitle: 'AIに予定を伝える',
    talkHint:
      'コピーした依頼文をAIに貼り付けると、AIが質問しながら案内します。設定の知識は要りません。作りたい予定をそのまま伝えても、業務の相談から始めてもかまいません。',
    examples: [
      {
        label: '自分の予定を伝える',
        text: '毎月25日が支払日です。休業日なら前営業日にします。\n3営業日前に振込データ作成、翌営業日に支払確認を行います。',
      },
      {
        label: '業務の相談から始める',
        text: '経理の月次業務で、毎月必要になる予定を提案してください。3月決算の小さな会社です。',
      },
    ],
    placeholder: '例: 毎月25日が支払日です。休業日なら前営業日にします。',
    needsRules: false,
  },
  revise: {
    label: '今の予定を直す',
    hint: '登録済みの予定をAIに渡して、直したい内容を伝えます。直した結果は、変更前と見比べてから反映します。',
    talkTitle: 'AIに直したいことを伝える',
    talkHint: 'AIが、どの予定をどう直したいかを尋ねます。設定の名前を知らなくても、業務の言葉で伝えればかまいません。',
    examples: [
      { label: '直したいことを伝える', text: '「支払」の振込データ作成を、3営業日前から5営業日前に変えたいです。' },
    ],
    placeholder: '例: 「支払」の振込データ作成を5営業日前に変えたい',
    needsRules: true,
  },
  review: {
    label: '点検してもらう',
    hint: '登録済みの予定をAIに渡して、漏れや不自然な設定がないかを業務の目で見てもらいます。',
    talkTitle: 'AIの点検結果を見る',
    talkHint: 'AIが気づいた点を表で示します。直したいものがあれば、そのまま頼めます。',
    examples: [{ label: '直してもらう', text: '点検結果の1番と3番を直してください。' }],
    placeholder: '例: 月次の締めまわりを重点的に見てください',
    needsRules: true,
  },
  handover: {
    label: '引き継ぎ資料',
    hint: '登録済みの予定と、アプリが計算した直近の日付をAIに渡して、業務の引き継ぎ資料を作ってもらいます。',
    talkTitle: 'AIに資料を作ってもらう',
    talkHint: 'AIが、誰が読む資料かなどを尋ねてから資料を作ります。資料はAIの画面からそのままコピーして使えます。',
    examples: [
      { label: '頼み方の例', text: '4月から経理を担当する後任者向けに、月次の業務が分かる資料にしてください。' },
    ],
    placeholder: '例: 後任者向けに、月次の業務が分かる資料にしてください',
    pasteHint: '資料はAIの画面でそのまま使えます。予定を作ったり直したりする設定データが返ってきたときだけ、ここに貼り付けます。',
    needsRules: true,
  },
  question: {
    label: '予定について質問',
    hint: '登録済みの予定と、アプリが計算した日付をAIに渡して、予定について質問します。AIは日付を計算せず、アプリの計算した日付で答えます。',
    talkTitle: 'AIに質問する',
    talkHint: 'アプリが計算した日付をもとに、AIが答えます。渡した期間より先の日付は、アプリのカレンダーで確かめてください。',
    examples: [{ label: '質問の例', text: '来月いちばん予定が多い週はいつですか？' }],
    placeholder: '例: 来月いちばん予定が多い週はいつですか？',
    pasteHint: '答えはAIの画面で読めます。予定を作ったり直したりする設定データが返ってきたときだけ、ここに貼り付けます。',
    needsRules: true,
  },
};

/** 依頼文がこれより長いと、貼り付けられない AI もあると知らせる。 */
const LONG_PROMPT = 40_000;

/** 写せなかったときに、その場で選んでコピーしてもらうための欄。 */
function manualCopyBox(summary: string, text: string): { box: HTMLDetailsElement; area: HTMLTextAreaElement } {
  const area = h('textarea', { class: 'input ai-copy-text', readonly: true, rows: 6 });
  area.value = text;
  area.setAttribute('aria-label', summary);
  const box = h('details', { class: 'advanced-options ai-copy-box' }, h('summary', {}, summary), area);
  return { box, area };
}

export class AiImportView {
  readonly element: HTMLElement;
  private readonly steps: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly result = h('div', { class: 'ai-import-result' });
  private readonly closeActions = h('div', { class: 'editor-actions ai-close-actions' });
  private readonly groups: string[];
  private purpose: AiPurpose = 'create';
  private share: AiShareOptions = defaultShareOptions('create');
  private request = '';
  private prompt = '';

  // 手順1で、選び直すたびに書き換えるところ。
  private readonly purposeButtons = new Map<AiPurpose, HTMLButtonElement>();
  private readonly purposeHint = h('p', { class: 'field-hint ai-purpose-hint' });
  private readonly requestInput: HTMLTextAreaElement;
  private readonly shareBox = h('div', { class: 'ai-share-options' });
  private shareInputs: {
    rules: HTMLInputElement;
    notes: HTMLInputElement;
    calendars: HTMLInputElement;
    occurrences: HTMLInputElement;
    months: HTMLSelectElement;
  } | null = null;
  private readonly shareSummary = h('p', { class: 'ai-share-summary', role: 'status', 'aria-live': 'polite' });
  private readonly shareNote = h('p', { class: 'issue issue-warning ai-share-note' });
  private readonly promptArea: HTMLTextAreaElement;
  private readonly promptBox: HTMLDetailsElement;
  private readonly copyStatus = h('p', { class: 'ai-copy-status', role: 'status', 'aria-live': 'polite' });
  // 手順2・3の、頼むことで変わるところ。
  private readonly talkStep = h('li', { class: 'ai-step' });
  private readonly pasteHint = h('p', { class: 'field-hint ai-paste-hint' });

  constructor(
    private readonly calendars: readonly BusinessCalendar[],
    private readonly ctx: ScheduleContext,
    private readonly today: string,
    private readonly handlers: AiImportHandlers,
    /**
     * 登録済みのルール。利用者が選んだときだけ依頼文に入れる。直す指示の
     * 突き合わせにも使う。グループ名は、AI に同じ名前を使ってもらうため常に入れる。
     */
    private readonly rules: readonly Rule[] = [],
  ) {
    this.groups = collectGroups(rules);
    const { box, area } = manualCopyBox('依頼文を表示', '');
    this.promptBox = box;
    this.promptArea = area;
    this.requestInput = h('textarea', {
      class: 'input ai-request-input',
      rows: 2,
      maxlength: AI_REQUEST_LIMIT,
    });
    this.requestInput.addEventListener('input', () => {
      this.request = this.requestInput.value;
      this.refreshPrompt();
    });

    this.input = h('textarea', {
      class: 'input ai-import-input',
      rows: 8,
      maxlength: AI_IMPORT_LIMITS.inputLength,
      placeholder: 'ここに AI の回答をそのまま貼り付けます（説明文が付いていてもかまいません）',
      spellcheck: 'false',
    });

    this.steps = h(
      'ol',
      { class: 'ai-steps' },
      this.buildCopyStep(),
      this.talkStep,
      h(
        'li',
        { class: 'ai-step' },
        h('h3', { class: 'ai-step-title' }, 'AIの回答を貼り付け'),
        this.pasteHint,
        field('AIから返ってきた内容を貼り付け', this.input),
        h(
          'div',
          { class: 'ai-step-actions' },
          button('内容を確認', () => this.check(), 'button button-primary'),
        ),
      ),
    );

    this.element = h(
      'section',
      { class: 'ai-import', 'aria-labelledby': 'ai-import-heading' },
      h('h2', { class: 'editor-title', id: 'ai-import-heading' }, 'AIで作る・見直す'),
      h(
        'p',
        { class: 'field-hint' },
        'ChatGPT、Claude、Geminiなど、お使いのAIに予定の設定を作ってもらったり、登録済みの予定を見直してもらったりできます。' +
          'このアプリからAIへ通信することはありません。日付はこのアプリの営業日カレンダーで計算し、確認してから登録します。',
      ),
      this.steps,
      this.result,
      this.closeActions,
    );
    this.closeActions.append(button('閉じる', () => this.handlers.onClose(), 'button'));
    this.buildShareOptions();
    this.choosePurpose('create');
  }

  /** 貼り付けた内容や書きかけの依頼があれば、閉じる前に確かめる。 */
  isDirty(): boolean {
    return this.input.value.trim() !== '' || this.request.trim() !== '';
  }

  /** 今の選び方で組み立てた依頼文。コピーする文と同じもの。 */
  get promptText(): string {
    return this.prompt;
  }

  private buildCopyStep(): HTMLElement {
    const purposes = h('div', { class: 'tabs ai-purposes' });
    const hasRules = this.rules.length > 0;
    for (const purpose of AI_PURPOSES) {
      const guide = PURPOSES[purpose];
      const choice = h(
        'button',
        { type: 'button', class: 'tab', 'aria-pressed': 'false' },
        guide.label,
      );
      // 予定が無いと直すものも点検するものも無い。押せない理由は説明に出す。
      if (guide.needsRules && !hasRules) choice.disabled = true;
      choice.addEventListener('click', () => this.choosePurpose(purpose));
      this.purposeButtons.set(purpose, choice);
      purposes.append(choice);
    }

    const copy = button(
      'AIへの依頼文をコピー',
      () =>
        void this.copy(
          this.prompt,
          this.copyStatus,
          this.promptBox,
          this.promptArea,
          '依頼文をコピーしました。AIの入力欄に貼り付けてください。',
        ),
      'button button-primary',
    );
    return h(
      'li',
      { class: 'ai-step' },
      h('h3', { class: 'ai-step-title' }, 'AIへの依頼文をコピー'),
      field('AIに頼むこと', purposes),
      this.purposeHint,
      hasRules
        ? null
        : h('p', { class: 'field-hint' }, '「今の予定を直す」などは、予定を登録すると選べます。'),
      field('最初に伝えること（任意）', this.requestInput, '書いておくと、AIはそこから始めます。AIの画面で伝えてもかまいません。'),
      h(
        'details',
        { class: 'advanced-options ai-share' },
        h('summary', {}, 'AIに渡す内容'),
        this.shareBox,
      ),
      this.shareSummary,
      this.shareNote,
      h('div', { class: 'ai-step-actions' }, copy),
      this.copyStatus,
      this.promptBox,
    );
  }

  /** 頼むことを選ぶ。渡す内容はその頼みごとの既定に戻す。 */
  private choosePurpose(purpose: AiPurpose): void {
    this.purpose = purpose;
    this.share = defaultShareOptions(purpose);
    const guide = PURPOSES[purpose];
    for (const [key, choice] of this.purposeButtons) {
      choice.setAttribute('aria-pressed', key === purpose ? 'true' : 'false');
    }
    this.purposeHint.textContent = guide.hint;
    this.requestInput.placeholder = guide.placeholder;
    this.syncShareOptions();
    this.renderTalkStep();
    this.pasteHint.textContent = guide.pasteHint ?? '';
    this.pasteHint.hidden = guide.pasteHint === undefined;
    this.copyStatus.textContent = '';
    this.refreshPrompt();
  }

  /**
   * 渡す内容の選択欄。1度だけ作り、選び直しでは値だけを書き換える
   * （作り直すと、キーボードで操作している人のフォーカスが失われる）。
   */
  private buildShareOptions(): void {
    const update = (next: Partial<AiShareOptions>): void => {
      this.share = { ...this.share, ...next };
      this.syncShareOptions();
      this.refreshPrompt();
    };
    const rules = checkbox(`登録済みの予定（${this.rules.length} 件）`, false, (value) => update({ rules: value }));
    const notes = checkbox('メモも含める', false, (value) => update({ notes: value }));
    notes.classList.add('ai-share-sub');
    const calendars = checkbox('営業日カレンダーの決め方（休業日・決算月）', false, (value) =>
      update({ calendars: value }),
    );
    const occurrences = checkbox('アプリが計算した予定の一覧', false, (value) => update({ occurrences: value }));
    const months = select(
      OCCURRENCE_MONTH_CHOICES.map((count) => ({ value: String(count), label: `今月から ${count} か月` })),
      String(this.share.months),
      (value) => update({ months: Number(value) }),
    );
    months.setAttribute('aria-label', '予定の一覧の期間');
    this.shareInputs = {
      rules: rules.querySelector('input') as HTMLInputElement,
      notes: notes.querySelector('input') as HTMLInputElement,
      calendars: calendars.querySelector('input') as HTMLInputElement,
      occurrences: occurrences.querySelector('input') as HTMLInputElement,
      months,
    };
    this.shareBox.append(
      rules,
      notes,
      h(
        'p',
        { class: 'field-hint ai-share-sub' },
        'メモには取引先名や金額などが書かれていることがあります。必要なときだけ含めてください。',
      ),
      calendars,
      occurrences,
      h('div', { class: 'ai-share-sub' }, months),
      h(
        'p',
        { class: 'field-hint' },
        '予定の一覧を渡すと、AIは日付を自分で計算せず、アプリが計算した日付で答えます。',
      ),
    );
  }

  /** 選択欄を今の選び方に合わせる。親を外した子（メモ・期間）は選べなくする。 */
  private syncShareOptions(): void {
    const inputs = this.shareInputs;
    if (inputs === null) return;
    inputs.rules.checked = this.share.rules;
    inputs.notes.checked = this.share.notes;
    inputs.notes.disabled = !this.share.rules;
    inputs.calendars.checked = this.share.calendars;
    inputs.occurrences.checked = this.share.occurrences;
    inputs.months.value = String(this.share.months);
    inputs.months.disabled = !this.share.occurrences;
  }

  private renderTalkStep(): void {
    const guide = PURPOSES[this.purpose];
    clear(this.talkStep);
    this.talkStep.append(
      h('h3', { class: 'ai-step-title' }, guide.talkTitle),
      h('p', { class: 'field-hint' }, guide.talkHint),
      ...guide.examples.map((example) =>
        h(
          'div',
          { class: 'ai-example' },
          h('p', { class: 'ai-example-label' }, example.label),
          h('p', { class: 'ai-example-text' }, example.text),
        ),
      ),
    );
  }

  /** 今の選び方で依頼文を組み立て直し、渡す内容と長さを見せる。 */
  private refreshPrompt(): void {
    const shared = buildSharedData(
      { rules: this.rules, calendars: this.calendars },
      this.share,
      this.ctx,
      this.today,
    );
    this.prompt = buildAiPrompt({
      calendars: this.calendars,
      groups: this.groups,
      purpose: this.purpose,
      shared,
      request: this.request,
    });
    this.promptArea.value = this.prompt;

    const parts: string[] = [];
    if (shared.rules !== undefined) {
      parts.push(`予定 ${shared.rules.lines.length} 件${shared.rules.withNotes ? '（メモを含む）' : ''}`);
    }
    if (shared.calendars !== undefined) parts.push('営業日カレンダーの決め方');
    if (shared.occurrences !== undefined) {
      parts.push(`予定の一覧（${shared.occurrences.from}〜${shared.occurrences.to}）`);
    }
    const length = `依頼文は約 ${this.prompt.length.toLocaleString('ja-JP')} 文字です。`;
    this.shareSummary.textContent =
      parts.length === 0
        ? `渡す登録内容: なし（営業日カレンダーとグループの名前だけ）。${length}`
        : `渡す登録内容: ${parts.join('・')}。${length}`;

    const notes: string[] = [];
    if (parts.length > 0) {
      notes.push('予定の名前などの業務の情報がAIに渡ります。お使いのAIの契約や社内のルールで、渡してよいか確かめてください。');
    }
    if (this.prompt.length > LONG_PROMPT) {
      notes.push('依頼文が長めです。AIによっては一度に貼り付けられないことがあります。予定の一覧の期間を短くすると減らせます。');
    }
    this.shareNote.textContent = notes.join(' ');
    this.shareNote.hidden = notes.length === 0;
  }

  private async copy(
    text: string,
    status: HTMLElement,
    box: HTMLDetailsElement,
    area: HTMLTextAreaElement,
    done: string,
  ): Promise<void> {
    let copied = false;
    try {
      copied = await this.handlers.copyText(text);
    } catch {
      copied = false;
    }
    if (copied) {
      status.textContent = done;
      return;
    }
    // 権限が無い・非対応の環境もある。その場で選んでコピーしてもらう。
    status.textContent = 'コピーできませんでした。下の文を選択してコピーしてください。';
    box.open = true;
    area.focus();
    area.select();
  }

  /** 貼り付けた回答を読み、問題があれば理由を、無ければ登録前の確認を出す。 */
  private check(): void {
    // 登録済みのルールは、依頼文に入れたかどうかに関わらず突き合わせに使う。
    // 前に渡した会話の続きで、直す指示が返ってくることもあるため。
    const result = readAiReply(this.input.value, { calendars: this.calendars, existingRules: this.rules });
    clear(this.result);
    if (!result.ok) {
      this.showErrors(result.issues);
      return;
    }
    const changed = result.updates.filter((update) => update.changed);
    this.showReview(
      buildImportPreview(result.rules, this.calendars, this.ctx, this.today),
      buildUpdatePreview(changed, this.calendars, this.ctx, this.today),
      result.updates.length - changed.length,
      result.issues.filter((issue) => issue.severity === 'warning'),
      result.rules,
      changed,
    );
  }

  private showErrors(issues: readonly AiImportIssue[]): void {
    const errors = issues.filter((issue) => issue.severity === 'error');
    const heading = h(
      'h3',
      { class: 'ai-result-title', tabindex: '-1' },
      'AIの回答を読み込めませんでした',
    );
    const list = h('ul', { class: 'ai-issues' });
    for (const issue of errors) {
      list.append(
        h(
          'li',
          { class: 'issue issue-error' },
          issue.subject === undefined ? issue.message : `${issue.subject}: ${issue.message}`,
        ),
      );
    }

    const fixText = buildFixRequest(issues);
    const status = h('p', { class: 'ai-copy-status', role: 'status', 'aria-live': 'polite' });
    const { box, area } = manualCopyBox('修正の依頼文を表示', fixText);
    const technical = h('ul', { class: 'ai-technical' });
    for (const issue of errors) {
      technical.append(h('li', {}, issue.path === '' ? issue.fix : `${issue.path}: ${issue.fix}`));
    }

    this.result.append(
      h(
        'div',
        { class: 'ai-errors' },
        heading,
        list,
        h(
          'p',
          { class: 'field-hint' },
          '登録はしていません。下のボタンで修正の依頼文をコピーしてAIに貼り付け、返ってきた回答をもう一度貼り付けてください。',
        ),
        h(
          'div',
          { class: 'ai-step-actions' },
          button(
            'AIへ修正を依頼する文をコピー',
            () => void this.copy(fixText, status, box, area, '修正の依頼文をコピーしました。AIに貼り付けてください。'),
            'button button-primary',
          ),
        ),
        status,
        box,
        h('details', { class: 'advanced-options' }, h('summary', {}, '技術的な詳細'), technical),
      ),
    );
    heading.focus();
    scrollIntoView(heading);
  }

  private showReview(
    preview: readonly ImportPreviewItem[],
    updatePreview: readonly UpdatePreviewItem[],
    unchanged: number,
    warnings: readonly AiImportIssue[],
    rules: Rule[],
    updates: RuleUpdate[],
  ): void {
    // 確認のあいだは〈キャンセル〉が閉じる役を持つ。同じ役のボタンを2つ並べない。
    this.steps.hidden = true;
    this.closeActions.hidden = true;
    const adds = preview.length;
    const changes = updatePreview.length;
    const counts = [adds > 0 ? `追加 ${adds} 件` : '', changes > 0 ? `変更 ${changes} 件` : '']
      .filter((part) => part !== '')
      .join('・');
    const heading = h(
      'h3',
      { class: 'ai-result-title', tabindex: '-1' },
      adds + changes === 0
        ? 'AIの回答に、変更する予定はありませんでした'
        : changes === 0
          ? `AIから次の予定が作成されました（${adds} 件）`
          : `AIから次の内容が届きました（${counts}）`,
    );
    const body = h(
      'div',
      { class: 'ai-review' },
      heading,
      h(
        'p',
        { class: 'field-hint' },
        changes === 0
          ? '日付は、AIではなくこのアプリの営業日カレンダーで計算しています。内容を確かめてから登録してください。まだ保存はしていません。'
          : '日付は、AIではなくこのアプリの営業日カレンダーで計算しています。変更前と変更後を見比べてから反映してください。まだ保存はしていません。',
      ),
    );
    if (unchanged > 0) {
      body.append(h('p', { class: 'field-hint' }, `AIの回答のうち、変更のない予定 ${unchanged} 件はそのままにします。`));
    }

    for (const issue of warnings) {
      body.append(
        h(
          'p',
          { class: 'issue issue-warning' },
          issue.subject === undefined ? issue.message : `${issue.subject}: ${issue.message}`,
        ),
      );
    }

    for (const item of updatePreview) body.append(this.renderUpdate(item));
    for (const item of preview) body.append(this.renderItem(item, changes > 0));

    const register =
      adds + changes === 0
        ? null
        : button(
            changes > 0
              ? `この内容で反映（${counts}）`
              : adds === 1
                ? 'この内容で登録'
                : `この内容で登録（${adds} 件）`,
            () => this.handlers.onRegister(rules, updates),
            'button button-primary',
          );
    body.append(
      h(
        'div',
        { class: 'editor-actions' },
        register,
        button('貼り直す', () => this.backToInput(), 'button'),
        button('キャンセル', () => this.handlers.onClose(), 'button button-quiet'),
      ),
    );
    this.result.append(body);
    heading.focus();
    scrollIntoView(heading);
  }

  /** 直す予定。変わる項目だけを、変更前と変更後で並べる。 */
  private renderUpdate(item: UpdatePreviewItem): HTMLElement {
    const { rule } = item;
    const changes = h('dl', { class: 'ai-changes' });
    for (const change of item.changes) {
      changes.append(
        h('dt', {}, change.label),
        h(
          'dd',
          {},
          h('span', { class: 'ai-change-before' }, `変更前: ${change.before}`),
          h('span', { class: 'ai-change-after' }, `変更後: ${change.after}`),
        ),
      );
    }
    const card = h(
      'article',
      { class: 'ai-preview-item ai-preview-update' },
      h('p', { class: 'ai-preview-badge' }, '変更'),
      h(
        'p',
        { class: 'rule-title' },
        h('span', { class: `rule-dot color-${rule.color}`, 'aria-hidden': 'true' }),
        rule.title,
      ),
      item.stale
        ? h(
            'p',
            { class: 'issue issue-warning' },
            'AIに渡したあとで、この予定はアプリで変更されています。反映すると、その変更は上書きされます。',
          )
        : null,
      changes,
    );
    this.appendSeries(card, item);
    return card;
  }

  private renderItem(item: ImportPreviewItem, badge = false): HTMLElement {
    const { rule } = item;
    const meta: HTMLElement[] = [h('span', { class: 'rule-calendar' }, item.calendarName)];
    if (rule.group !== undefined && rule.group !== '') {
      meta.push(h('span', { class: 'rule-group-tag' }, rule.group));
    }
    for (const notice of item.notices) meta.push(h('span', { class: 'rule-notice' }, notice));
    if (item.period !== '') meta.push(h('span', { class: 'rule-period' }, item.period));

    const card = h(
      'article',
      { class: 'ai-preview-item' },
      badge ? h('p', { class: 'ai-preview-badge ai-preview-badge-new' }, '追加') : null,
      h(
        'p',
        { class: 'rule-title' },
        h('span', { class: `rule-dot color-${rule.color}`, 'aria-hidden': 'true' }),
        rule.title,
      ),
      h('p', { class: 'rule-desc' }, item.summary),
      h('p', { class: 'rule-meta' }, ...meta),
      rule.note === undefined ? null : h('p', { class: 'rule-note' }, rule.note),
    );
    this.appendSeries(card, item);
    return card;
  }

  private appendSeries(card: HTMLElement, item: ImportPreviewItem): void {
    if (item.series.length === 0) {
      card.append(h('p', { class: 'issue issue-warning' }, 'この設定では発生する日がありません。'));
      return;
    }
    card.append(h('p', { class: 'ai-preview-label' }, `次の${item.series.length}回`), renderPreviewList(item.series));
  }

  private backToInput(): void {
    clear(this.result);
    this.steps.hidden = false;
    this.closeActions.hidden = false;
    this.input.focus();
    scrollIntoView(this.input, 'center');
  }
}
