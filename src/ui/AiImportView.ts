/**
 * AI で予定を作る（docs/SPEC.md §9.5）。
 *
 * 1. 依頼文をコピーして、利用者が自分の AI に貼る
 * 2. 作りたい予定を普通の言葉で AI に伝える
 * 3. 返ってきた回答をここへ貼る → 確認 → 登録
 *
 * このアプリから AI へは通信しない。回答は信用できない外部入力として
 * src/core/aiImport.ts で確かめ、日付はこのアプリの営業日計算で出して見せる。
 * 登録は〈この内容で登録〉を押したときだけ。
 */

import {
  AI_IMPORT_LIMITS,
  buildImportPreview,
  readAiReply,
} from '../core/aiImport';
import type { AiImportIssue, ImportPreviewItem } from '../core/aiImport';
import { buildAiPrompt, buildFixRequest } from '../core/aiPrompt';
import type { ScheduleContext } from '../core/schedule';
import type { BusinessCalendar, Rule } from '../types';
import { button, field } from './controls';
import { clear, h, scrollIntoView } from './dom';
import { renderPreviewList } from './previewList';

export type AiImportHandlers = {
  /** クリップボードへ写す。写せなければ false（その場で選んでコピーしてもらう）。 */
  copyText: (text: string) => Promise<boolean>;
  onRegister: (rules: Rule[]) => void;
  onClose: () => void;
};

const EXAMPLE_REQUEST =
  '毎月25日が支払日です。休業日なら前営業日にします。\n3営業日前に振込データ作成、翌営業日に支払確認を行います。';

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
  private readonly prompt: string;

  constructor(
    private readonly calendars: readonly BusinessCalendar[],
    private readonly ctx: ScheduleContext,
    private readonly today: string,
    private readonly handlers: AiImportHandlers,
  ) {
    this.prompt = buildAiPrompt(calendars);

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
      h(
        'li',
        { class: 'ai-step' },
        h('h3', { class: 'ai-step-title' }, 'AIに予定を伝える'),
        h(
          'p',
          { class: 'field-hint' },
          'コピーした依頼文をAIに貼り付け、そのあと作りたい予定を普通の言葉で伝えてください。例:',
        ),
        h('p', { class: 'ai-example' }, EXAMPLE_REQUEST),
      ),
      h(
        'li',
        { class: 'ai-step' },
        h('h3', { class: 'ai-step-title' }, 'AIの回答を貼り付け'),
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
      h('h2', { class: 'editor-title', id: 'ai-import-heading' }, 'AIで予定を作る'),
      h(
        'p',
        { class: 'field-hint' },
        'ChatGPT、Claude、Geminiなど、お使いのAIに予定の設定を作ってもらえます。' +
          'このアプリからAIへ通信することはありません。日付はこのアプリの営業日カレンダーで計算し、確認してから登録します。',
      ),
      this.steps,
      this.result,
      this.closeActions,
    );
    this.closeActions.append(button('閉じる', () => this.handlers.onClose(), 'button'));
  }

  /** 貼り付けた内容があれば、閉じる前に確かめる。 */
  isDirty(): boolean {
    return this.input.value.trim() !== '';
  }

  private buildCopyStep(): HTMLElement {
    const status = h('p', { class: 'ai-copy-status', role: 'status', 'aria-live': 'polite' });
    const { box, area } = manualCopyBox('依頼文を表示', this.prompt);
    const copy = button(
      'AIへの依頼文をコピー',
      () => void this.copy(this.prompt, status, box, area, '依頼文をコピーしました。AIの入力欄に貼り付けてください。'),
      'button button-primary',
    );
    return h(
      'li',
      { class: 'ai-step' },
      h('h3', { class: 'ai-step-title' }, 'AIへの依頼文をコピー'),
      h('div', { class: 'ai-step-actions' }, copy),
      status,
      box,
    );
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
    const result = readAiReply(this.input.value, { calendars: this.calendars });
    clear(this.result);
    if (!result.ok) {
      this.showErrors(result.issues);
      return;
    }
    const preview = buildImportPreview(result.rules, this.calendars, this.ctx, this.today);
    this.showReview(
      preview,
      result.issues.filter((issue) => issue.severity === 'warning'),
      result.rules,
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
    warnings: readonly AiImportIssue[],
    rules: Rule[],
  ): void {
    // 確認のあいだは〈キャンセル〉が閉じる役を持つ。同じ役のボタンを2つ並べない。
    this.steps.hidden = true;
    this.closeActions.hidden = true;
    const heading = h(
      'h3',
      { class: 'ai-result-title', tabindex: '-1' },
      `AIから次の予定が作成されました（${preview.length} 件）`,
    );
    const body = h(
      'div',
      { class: 'ai-review' },
      heading,
      h(
        'p',
        { class: 'field-hint' },
        '日付は、AIではなくこのアプリの営業日カレンダーで計算しています。内容を確かめてから登録してください。まだ保存はしていません。',
      ),
    );

    for (const issue of warnings) {
      body.append(
        h(
          'p',
          { class: 'issue issue-warning' },
          issue.subject === undefined ? issue.message : `${issue.subject}: ${issue.message}`,
        ),
      );
    }

    for (const item of preview) body.append(this.renderItem(item));

    const register = button(
      preview.length === 1 ? 'この内容で登録' : `この内容で登録（${preview.length} 件）`,
      () => this.handlers.onRegister(rules),
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

  private renderItem(item: ImportPreviewItem): HTMLElement {
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

    if (item.series.length === 0) {
      card.append(h('p', { class: 'issue issue-warning' }, 'この設定では発生する日がありません。'));
      return card;
    }
    card.append(h('p', { class: 'ai-preview-label' }, `次の${item.series.length}回`), renderPreviewList(item.series));
    return card;
  }

  private backToInput(): void {
    clear(this.result);
    this.steps.hidden = false;
    this.closeActions.hidden = false;
    this.input.focus();
    scrollIntoView(this.input, 'center');
  }
}
