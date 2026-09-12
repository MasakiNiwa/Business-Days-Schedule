/**
 * @vitest-environment jsdom
 *
 * サンプル取得の失敗と取り直し（docs/SPEC.md §9.3）。
 *
 * 失敗した記録を抱えたままだと、通信が戻って開き直しても取得処理へ入れない。
 * ページを読み込み直すしか手がなくなる。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { holidays } from './helpers';

const INDEX = {
  packs: [
    { id: 'tax', name: '税務・届出', description: '源泉所得税など。', file: 'tax.json', count: 9 },
  ],
};

/** 「完成例を見る」を押す。ルールが1件も無いときに出る導線。 */
async function openSamples(root: HTMLElement): Promise<void> {
  const target = [...root.querySelectorAll('button')].find((b) => b.textContent === '完成例を見る');
  if (target === undefined) throw new Error('「完成例を見る」が見つかりません');
  target.dispatchEvent(new MouseEvent('click'));
  // fetch の解決を待つ。
  await vi.waitFor(() => expect(document.querySelector('.samples')).not.toBeNull());
}

const closeSamples = (): void => {
  const target = [...document.querySelectorAll('button')].find((b) => b.textContent === '閉じる');
  target?.dispatchEvent(new MouseEvent('click'));
};

const shown = (): string => document.body.textContent ?? '';

let root: HTMLElement;

beforeEach(() => {
  globalThis.localStorage.clear();
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('サンプル一覧の取得に失敗したあと', () => {
  it('失敗したら理由を出す', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ネットワークに接続できません'));
    const app = new App(root, holidays);
    app.render();
    await openSamples(root);
    expect(shown()).toContain('サンプル一覧を読み込めませんでした');
  });

  it('開き直せば取り直す', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ネットワークに接続できません'))
      .mockResolvedValueOnce(new Response(JSON.stringify(INDEX), { status: 200 }));

    const app = new App(root, holidays);
    app.render();
    await openSamples(root);
    expect(shown()).toContain('サンプル一覧を読み込めませんでした');

    closeSamples();
    await openSamples(root);

    // 2回目は取れている。
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(shown()).toContain('税務・届出');
    expect(shown()).not.toContain('サンプル一覧を読み込めませんでした');
  });

  it('その場の〈再試行〉からも取り直せる', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ネットワークに接続できません'))
      .mockResolvedValueOnce(new Response(JSON.stringify(INDEX), { status: 200 }));

    const app = new App(root, holidays);
    app.render();
    await openSamples(root);

    const retry = [...document.querySelectorAll('button')].find((b) => b.textContent === '再試行');
    expect(retry).toBeDefined();
    retry?.dispatchEvent(new MouseEvent('click'));

    await vi.waitFor(() => expect(shown()).toContain('税務・届出'));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('一度取れていれば、もう取りに行かない', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(INDEX), { status: 200 }));

    const app = new App(root, holidays);
    app.render();
    await openSamples(root);
    closeSamples();
    await openSamples(root);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
