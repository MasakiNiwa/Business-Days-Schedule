/**
 * ブラウザでの通し確認。
 *
 * 単体テストでは拾えない「編集 → 再読込 → 再追加」のような、
 * 保存と画面をまたぐ流れを対象にする。実際にこの種の不具合を取り逃がしていた。
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const STORAGE_KEY = 'bds.v1.rules';

/** ヘッダーの「ルール」ボタン。空状態の「ルールを追加」と紛れないよう厳密に選ぶ。 */
async function openRulePanel(page: Page): Promise<void> {
  await page.locator('.header-actions').getByRole('button', { name: 'ルール', exact: true }).click();
}

/** モーダルの本文にある「閉じる」。右上の × と紛れないようにする。 */
async function closeDialog(page: Page): Promise<void> {
  await page.locator('dialog .editor-actions').getByRole('button', { name: '閉じる' }).click();
}

async function loadSamplePack(page: Page, name: string): Promise<void> {
  await openRulePanel(page);
  await expect(page.locator('dialog .rule-panel')).toBeVisible();
  await page.getByRole('button', { name: 'サンプル', exact: true }).click();
  await expect(page.locator('dialog .samples')).toBeVisible();
  await addSamplePack(page, name);
}

/** サンプル画面が開いている前提で、束をもう1つ足す。 */
async function addSamplePack(page: Page, name: string): Promise<void> {
  await page
    .locator('.sample-item')
    .filter({ hasText: name })
    .getByRole('button', { name: '追加', exact: true })
    .click();
  await expect(page.locator('.banner')).toContainText('追加');
}

test.describe('初回起動と永続化', () => {
  test('空の状態から サンプル追加 → 再読込しても残る', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('.empty-prompt')).toBeVisible();

    await page.getByRole('button', { name: 'サンプルを読み込む' }).click();
    await page
      .locator('.sample-item')
      .filter({ hasText: '基本セット' })
      .getByRole('button', { name: '追加', exact: true })
      .click();
    await closeDialog(page);

    await expect(page.locator('.empty-prompt')).toHaveCount(0);
    await expect(page.locator('.chip').first()).toBeVisible();

    await page.reload();
    await expect(page.locator('.chip').first()).toBeVisible();
    await expect(page.locator('.empty-prompt')).toHaveCount(0);
  });
});

test.describe('サンプルの再追加で編集内容を守る', () => {
  test('名前を変えたあと同じ束を追加しても上書きされない', async ({ page }) => {
    await page.goto('');
    await loadSamplePack(page, '基本セット');
    await closeDialog(page);

    // 1件の名前を変える。
    await openRulePanel(page);
    await page.locator('.rule').filter({ hasText: '月次締め' }).getByRole('button', { name: '編集' }).click();
    const title = page.getByLabel('タイトル');
    await title.fill('月次締め（自社ルール）');
    await page.getByRole('button', { name: '保存' }).click();

    // 再読込してから、同じ束をもう一度追加する。
    await page.reload();
    await loadSamplePack(page, '基本セット');
    await closeDialog(page);

    await openRulePanel(page);
    await expect(page.locator('.rule-title').filter({ hasText: '月次締め（自社ルール）' })).toHaveCount(1);
    await expect(page.locator('.rule-title').filter({ hasText: /^月次締め$/ })).toHaveCount(0);
  });
});

test.describe('長い事前通知', () => {
  test('60営業日前の通知が該当月に出る', async ({ page }) => {
    // UI で作ると手数が多いので、保存データを直接与えて表示だけを確かめる。
    await page.addInitScript(
      ([key, rules]) => window.localStorage.setItem(key as string, rules as string),
      [
        STORAGE_KEY,
        JSON.stringify([
          {
            id: 'long-notice',
            title: '長期準備',
            color: 'blue',
            enabled: true,
            calendarId: 'company',
            recurrence: { type: 'monthlyByDay', interval: 1, months: [11], days: [30], overflow: 'clamp' },
            adjust: { mode: 'prev', keepInMonth: false },
            notices: [{ offset: -60, unit: 'business', label: '準備開始' }],
            period: { start: null, end: null },
            skipDates: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      ],
    );
    await page.goto('');

    // 2026-08 へ移動する。
    await page.locator('.month-label').click();
    await expect(page.locator('.picker')).toBeVisible();
    const year = await page.locator('.picker-year').innerText();
    while ((await page.locator('.picker-year').innerText()) !== '2026') {
      await page.locator('.picker-head button').nth(year > '2026' ? 0 : 1).click();
    }
    await page.locator('.picker-month').filter({ hasText: '8月' }).click();

    await expect(page.locator('.chip.is-notice')).toHaveCount(1);
    await expect(page.locator('.chip.is-notice')).toContainText('準備開始');
  });
});

test.describe('書き出し', () => {
  test('iCalendar のセミコロンがエスケープされる', async ({ page }) => {
    await page.addInitScript(
      ([key, rules]) => window.localStorage.setItem(key as string, rules as string),
      [
        STORAGE_KEY,
        JSON.stringify([
          {
            id: 'semi',
            title: '締切;厳守',
            color: 'red',
            enabled: true,
            calendarId: 'company',
            recurrence: { type: 'monthlyByDay', interval: 1, days: [10], overflow: 'clamp' },
            adjust: { mode: 'none', keepInMonth: false },
            notices: [],
            period: { start: null, end: null },
            skipDates: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      ],
    );
    await page.goto('');
    // 書き出しはヘッダーから直接開ける（設定の奥に埋めない）。
    await page.getByRole('button', { name: '書き出し' }).click();
    await page.getByRole('button', { name: '3か月' }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '書き出す' }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const ics = Buffer.concat(chunks).toString('utf-8').split('\r\n ').join('');

    expect(ics).toContain(String.raw`SUMMARY:締切\;厳守`);
    expect(ics).toContain('BEGIN:VEVENT');
  });
});

test.describe('入力欄の名前', () => {
  test('ラベルが入力欄と結び付いている', async ({ page }) => {
    await page.goto('');
    await openRulePanel(page);
    await page.getByRole('button', { name: '＋ 新規ルール' }).click();

    // プレースホルダーではなくラベルで引けること。
    await expect(page.getByLabel('タイトル')).toBeVisible();
    await expect(page.getByLabel('営業日カレンダー')).toBeVisible();
    await page.getByText('色・メモ・有効／無効', { exact: true }).click();
    await expect(page.getByLabel('メモ')).toBeVisible();
  });

  test('第N営業日では補正欄を出さない', async ({ page }) => {
    await page.goto('');
    await openRulePanel(page);
    await page.getByRole('button', { name: '＋ 新規ルール' }).click();

    await expect(page.getByLabel('休業日の場合', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '第N営業日' }).click();
    await expect(page.getByLabel('休業日の場合', { exact: true })).toBeHidden();
    await expect(page.locator('.editor-section').filter({ hasText: '休業日にあたったとき' })).toContainText(
      '補正の設定はありません',
    );
  });
});

test.describe('表示', () => {
  test('横スクロールが出ない', async ({ page }) => {
    await page.goto('');
    await loadSamplePack(page, '基本セット');
    await closeDialog(page);

    const overflow = await page.evaluate(
      () => document.body.scrollWidth > document.body.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test('印刷では白地・黒文字になる', async ({ page }) => {
    await page.goto('');
    await page.emulateMedia({ media: 'print' });
    const colors = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      foreground: getComputedStyle(document.documentElement).getPropertyValue('--fg').trim(),
    }));
    expect(colors.background).toBe('rgb(255, 255, 255)');
    expect(colors.foreground).toBe('#000');
    await expect(page.locator('.brand-bar')).toBeHidden();
    await expect(page.locator('.footer-version')).toBeHidden();
  });

  test('印刷に画面用の操作を出さない', async ({ page }) => {
    await page.goto('');
    await loadSamplePack(page, '税務');
    await closeDialog(page);
    await page.emulateMedia({ media: 'print' });

    // 紙の上では押せないので出さない。
    await expect(page.locator('.toolbar-right')).toBeHidden();
    await expect(page.locator('.toolbar-left .field')).toBeHidden();
    // 営業日数と決算月は紙に残る情報として意味があるので出す。
    await expect(page.locator('.month-summary')).toBeVisible();
  });

  test('点表示のままでも印刷には予定名が出る', async ({ page }) => {
    // 紙には色の点しか残らず何も読めなくなるため。
    await page.goto('');
    await loadSamplePack(page, '税務');
    await closeDialog(page);
    await page.getByRole('button', { name: '点', exact: true }).click();
    await expect(page.locator('.chips .chip-label').first()).toBeHidden();

    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.chips .chip-label').first()).toBeVisible();
  });

  test('絞り込んだグループを紙にも残す', async ({ page }) => {
    // 絞り込んだ結果だけを渡されると、全部だと誤解される。
    await page.goto('');
    await loadSamplePack(page, '税務');
    await closeDialog(page);
    await page.locator('.toolbar-left select').selectOption('税務');

    await expect(page.locator('.print-group')).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.print-group')).toHaveText('グループ: 税務');
  });
});

test('給与のひな型から1件保存できる', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'ルールを追加', exact: true }).click();
  await page.getByRole('button', { name: '給与', exact: true }).click();
  await expect(page.getByLabel('タイトル')).toHaveValue('給与振込');
  await expect(page.getByLabel('営業日カレンダー')).toHaveValue('bank');
  await expect(page.locator('.rule-summary')).toContainText('25日');
  // 詳細を開かなくても、直近の日付が見えること。
  await expect(page.locator('.next-dates')).toContainText('直近');
  await expect(page.locator('.next-dates-chain')).toContainText('給与振込');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.reload();
  await openRulePanel(page);
  await expect(page.locator('.rule-title')).toHaveText('給与振込');
});

test('サンプルから1件だけ選んで追加できる', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'サンプルを読み込む' }).click();
  const pack = page.locator('.sample-item').filter({ hasText: '基本セット' });
  await pack.getByRole('button', { name: '内容を選ぶ' }).click();
  await pack.getByRole('checkbox', { name: /給与振込/ }).check();
  await pack.getByRole('button', { name: '選んだ 1 件を追加' }).click();
  await closeDialog(page);
  await openRulePanel(page);
  await expect(page.locator('.rule-title')).toHaveCount(1);
  await expect(page.locator('.rule-title')).toHaveText('給与振込');
});

test.describe('予定の出し方の切り替え', () => {
  test('既定は内容が見える形', async ({ page }) => {
    // 初期状態では予定名まで出す。点にするかは利用者が選ぶ（画面幅では決めない）。
    await page.goto('');
    await loadSamplePack(page, '基本セット');
    await closeDialog(page);

    await expect(page.locator('.chips .chip-label').first()).toBeVisible();
    await expect(page.locator('.legend-wide').first()).toBeVisible();
    await expect(page.locator('.legend-narrow').first()).toBeHidden();
  });

  test('点に切り替えると名前を隠して1か月を見渡せる', async ({ page }) => {
    await page.goto('');
    await loadSamplePack(page, '基本セット');
    await closeDialog(page);
    const tall = await page.locator('.calendar').evaluate((el) => el.scrollHeight);

    await page.getByRole('button', { name: '点', exact: true }).click();

    await expect(page.locator('.chips .chip-label').first()).toBeHidden();
    const chip = page.locator('.chips .chip').first();
    const box = await chip.boundingBox();
    expect(box?.width).toBeLessThan(16);
    expect(box?.height).toBeLessThan(16);
    // 点にした意味があること（縦に詰まる）。
    const short = await page.locator('.calendar').evaluate((el) => el.scrollHeight);
    expect(short).toBeLessThan(tall);

    // 凡例も点向けの説明に入れ替わる。
    await expect(page.locator('.legend-narrow').first()).toBeVisible();
    await expect(page.locator('.legend-wide').first()).toBeHidden();
  });

  test('選んだ出し方は再読込しても残る', async ({ page }) => {
    await page.goto('');
    await loadSamplePack(page, '基本セット');
    await closeDialog(page);
    await page.getByRole('button', { name: '点', exact: true }).click();
    await expect(page.locator('.chips .chip-label').first()).toBeHidden();

    await page.reload();
    await expect(page.locator('.chips .chip-label').first()).toBeHidden();
  });
});

test.describe('グループ', () => {
  test('選んだグループだけを表示し、書き出しにも引き継ぐ', async ({ page }) => {
    await page.goto('');
    await loadSamplePack(page, '税務');
    await addSamplePack(page, '会議・報告');
    await closeDialog(page);

    const all = await page.locator('.chips .chip').count();

    await page.locator('.toolbar-left select').selectOption('税務');
    const narrowed = await page.locator('.chips .chip').count();
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(all);

    // 見ているものと渡すものが食い違うと、画面に無い予定が取り込み先へ紛れ込む。
    await page.getByRole('button', { name: '書き出し' }).click();
    const target = page.locator('.export select').first();
    await expect(target).toHaveValue('税務');
  });

  test('グループが1つも無ければ絞り込み欄を出さない', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('.toolbar-left select')).toHaveCount(0);
  });
});

test.describe('書き出しの初期値', () => {
  test('既定は今月の1日から末日', async ({ page }) => {
    // 試しに1回押しただけで1年分が取り込み先へ流れ込む事故を防ぐ。
    await page.goto('');
    await page.getByRole('button', { name: '書き出し' }).click();

    const dates = page.locator('.export input[type="date"]');
    const from = await dates.nth(0).inputValue();
    const to = await dates.nth(1).inputValue();
    expect(from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(to.slice(0, 7)).toBe(from.slice(0, 7));

    await expect(page.getByText('取り込み先は専用のカレンダーを作ってから')).toBeVisible();
  });
});

test.describe('サンプルの内容表示', () => {
  test('開いたあと畳める', async ({ page }) => {
    // 12件の束を開くと画面がその一覧で埋まる。畳めないと他の束を見に行けない。
    await page.goto('');
    await openRulePanel(page);
    await page.getByRole('button', { name: 'サンプル', exact: true }).click();
    await expect(page.locator('dialog .samples')).toBeVisible();

    const item = page.locator('.sample-item').filter({ hasText: '税務' });
    // 一覧の下端にも同じ言葉のボタンがあるので、上の操作列に絞る。
    const toggle = item.locator('.sample-actions').getByRole('button', { name: /内容を(選ぶ|閉じる)/ });

    await toggle.click();
    await expect(item.locator('.sample-choices .checkbox').first()).toBeVisible();
    await expect(toggle).toHaveText('内容を閉じる');

    await toggle.click();
    await expect(item.locator('.sample-choices')).toBeHidden();
    await expect(toggle).toHaveText('内容を選ぶ');

    // 畳んだあとも開き直せる（取得済みの中身を捨てていない）。
    await toggle.click();
    await expect(item.locator('.sample-choices .checkbox').first()).toBeVisible();
  });

  test('一覧の下端にも畳む手がある', async ({ page }) => {
    await page.goto('');
    await openRulePanel(page);
    await page.getByRole('button', { name: 'サンプル', exact: true }).click();
    const item = page.locator('.sample-item').filter({ hasText: '税務' });
    await item.locator('.sample-actions').getByRole('button', { name: '内容を選ぶ' }).click();
    await expect(item.locator('.sample-choices .checkbox').first()).toBeVisible();

    await item.locator('.sample-choices-actions').getByRole('button', { name: '内容を閉じる' }).click();
    await expect(item.locator('.sample-choices')).toBeHidden();
  });
});

test.describe('決算月への導線', () => {
  test('カレンダーの上に決算月が出ていて、押すと設定が開く', async ({ page }) => {
    // 決算月から逆算できること自体に気づかれなかった。
    // 何が効いているかを見せる場所を、そのまま入口にする。
    await page.goto('');
    const summary = page.locator('.month-summary.is-link');
    await expect(summary).toContainText('決算月');

    await summary.click();
    await expect(page.locator('dialog')).toBeVisible();
    // 営業日カレンダーは自社・銀行の2つあり、どちらにも決算月がある。
    await expect(page.getByText('事業年度の終わる月').first()).toBeVisible();
  });
});

test.describe('フォロー予定', () => {
  test('本体の後ろに置く予定を作れる', async ({ page }) => {
    await page.goto('');
    await loadSamplePack(page, '売上・入金');
    await closeDialog(page);

    // サンプルの「入金予定日」には翌営業日のフォローが付いている。
    await page.locator('.header-actions').getByRole('button', { name: '一覧' }).click();
    await expect(page.locator('.list-notice-origin').first()).toContainText('のフォロー');
  });

  test('編集画面から前後どちらも足せる', async ({ page }) => {
    await page.goto('');
    await openRulePanel(page);
    await page.getByRole('button', { name: '＋ 新規ルール' }).click();
    await page.getByRole('button', { name: '自由入力' }).click();

    await page.getByRole('button', { name: '＋ フォローを追加（後）' }).click();
    const direction = page.getByLabel('1 件目: 本体の前か後か');
    await expect(direction).toHaveValue('after');

    await page.getByRole('button', { name: '＋ 準備日を追加（前）' }).click();
    await expect(page.getByLabel('2 件目: 本体の前か後か')).toHaveValue('before');
  });

  test('週と曜日で決められる', async ({ page }) => {
    // 「翌週の水曜、水曜が休みなら木曜」を日数へ言い換えさせない。
    await page.goto('');
    await openRulePanel(page);
    await page.getByRole('button', { name: '＋ 新規ルール' }).click();
    await page.getByRole('button', { name: '自由入力' }).click();

    await page.getByRole('button', { name: '＋ フォローを追加（後）' }).click();
    await page.getByLabel('1 件目: 日付の決め方').selectOption('weekday');

    await page.getByLabel('1 件目: どの週か').selectOption('1');
    await page.getByLabel('1 件目: 曜日', { exact: true }).selectOption('3');
    await page.getByLabel('1 件目: 曜日が休業日のとき').selectOption('next');

    // 決まった内容を文章でも出す。設定欄だけでは読み取りにくいため。
    await expect(page.locator('.notice-item .field-hint')).toContainText(
      '翌週の水曜 / 休業日なら翌営業日へ',
    );
  });

  test('月と第N営業日で決められる', async ({ page }) => {
    await page.goto('');
    await openRulePanel(page);
    await page.getByRole('button', { name: '＋ 新規ルール' }).click();
    await page.getByRole('button', { name: '自由入力' }).click();

    await page.getByRole('button', { name: '＋ フォローを追加（後）' }).click();
    await page.getByLabel('1 件目: 日付の決め方').selectOption('monthlyBusinessDay');
    await page.getByLabel('1 件目: どの月か').selectOption('1');

    await expect(page.locator('.notice-item .field-hint')).toContainText('翌月の第5営業日');
  });
});

test.describe('グループの気づきやすさ', () => {
  test('グループを使っていない人にも案内を出す', async ({ page }) => {
    // 絞り込み欄そのものが出ないため、機能があること自体に気づけない。
    await page.goto('');
    await loadSamplePack(page, '基本セット');
    // サンプルにはグループが付いているので、まず外した状態を作る。
    await page.evaluate(() => {
      const key = 'bds.v1.rules';
      const rules = JSON.parse(window.localStorage.getItem(key) ?? '[]') as { group?: string }[];
      for (const rule of rules) delete rule.group;
      window.localStorage.setItem(key, JSON.stringify(rules));
    });
    await page.reload();

    await expect(page.locator('.toolbar-left select')).toHaveCount(0);
    await openRulePanel(page);
    await expect(page.locator('.callout-info')).toContainText('グループで束ねられます');
  });

  test('グループが付いていれば一覧に出る', async ({ page }) => {
    await page.goto('');
    await loadSamplePack(page, '税務');
    await closeDialog(page);
    await openRulePanel(page);
    await expect(page.locator('.rule-group-tag').first()).toHaveText('税務');
  });
});

test.describe('ヘルプ', () => {
  test('目次から節へ飛べる', async ({ page }) => {
    await page.goto('');
    await page.locator('.header-actions').getByRole('button', { name: 'ヘルプ' }).click();
    await expect(page.locator('.help-toc-link').first()).toBeVisible();

    await page.getByRole('link', { name: '決算月から逆算する' }).click();
    await expect(page.locator('#help-fiscal')).toBeInViewport();
  });
});

test.describe('ひな型とグループ', () => {
  test('絞り込み中にひな型を選んでもグループが残る', async ({ page }) => {
    // グループが消えると、保存した直後に絞り込み中の画面から消えて戸惑わせる。
    await page.goto('');
    await loadSamplePack(page, '基本セット');
    await closeDialog(page);
    await page.locator('.toolbar-left select').selectOption('基本');

    await openRulePanel(page);
    await page.getByRole('button', { name: '＋ 新規ルール' }).click();
    // 画面上部の絞り込みにも「グループ」があるので、編集画面の欄に絞る。
    const groupField = page.locator('dialog').getByLabel('グループ');
    await expect(groupField).toHaveValue('基本');

    await page.getByRole('button', { name: '給与', exact: true }).click();
    await expect(groupField).toHaveValue('基本');
  });
});
