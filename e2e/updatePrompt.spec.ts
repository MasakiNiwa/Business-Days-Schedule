/**
 * 最新版を見ているのに更新案内が出ないこと（docs/SPEC.md §13）。
 *
 * 画面遷移はネットワーク優先で、資産名には内容のハッシュが入っている。
 * オンラインで開いた時点の画面は既に最新版なので、そこで「新しい版があります」
 * と出しても、押しても何も変わらない。実際にその状態になっていた。
 *
 * ここだけは実際に dist を作り直して確かめる。作り直している最中の dist を
 * 他の検査が読むと、あるはずの資産が無い状態に当たるため、既定の並行実行からは
 * 外して単独で走らせる（playwright.config.ts の update プロジェクト）。
 */

import { expect, test } from '@playwright/test';

// dist を作り直しながら確かめるので、順に走らせる（npm run e2e:update）。
test.describe.configure({ mode: 'serial' });
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MARKER = resolve(ROOT, 'src/core/buildInfo.ts');

/**
 * 元の中身は最初に1度だけ読む。
 *
 * 検査ごとに読み直すと、前の検査が書き足したものを「元の中身」として
 * 覚えてしまい、戻したつもりで書き足しが残る。実際に残った。
 */
const ORIGINAL = readFileSync(MARKER, 'utf-8');

const build = (): void => {
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
};

/** 追記を消して作り直す。何度呼んでも同じ状態になる。 */
function restore(): void {
  if (readFileSync(MARKER, 'utf-8') === ORIGINAL) return;
  writeFileSync(MARKER, ORIGINAL, 'utf-8');
  build();
}

/** 中身を変えて作り直す。資産名のハッシュが変わり、新しい版になる。 */
function rebuildWithChange(): void {
  writeFileSync(MARKER, `${ORIGINAL}\n// 更新検知の検査用に中身を変える。\n`, 'utf-8');
  build();
}

// 検査が途中で落ちても、作業ツリーを元に戻す。
test.afterEach(() => {
  restore();
});

test('新しい版が出たあとに開き直しても、更新案内を出さない', async ({ page }) => {
  await page.goto('');
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active !== undefined;
  });

  rebuildWithChange();
  try {
    // 開き直すと、画面遷移はネットワーク優先なので新しい版が出る。
    await page.reload();
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.waiting !== null || registration?.installing !== null;
    }, undefined, { timeout: 15_000 }).catch(() => {
      // 控えが立たないまま切り替わることもある。それでも案内は出ないはず。
    });

    // 新しい版を見ているので、案内は出さない。
    await page.waitForTimeout(3_000);
    await expect(page.locator('#update-banner')).toHaveCount(0);
  } finally {
    restore();
  }
});

test('開いたままの画面が古くなったら、これまでどおり案内を出す', async ({ page }) => {
  // 開いている間に新しい版が出た場合は、画面のほうが古い。ここは知らせたい。
  await page.goto('');
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active !== undefined;
  });

  rebuildWithChange();
  try {
    // 開いたまま更新を確かめに行かせる（画面は古い版のまま）。
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });

    await expect(page.locator('#update-banner')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('#update-banner')).toContainText('新しい版があります');
  } finally {
    restore();
  }
});
