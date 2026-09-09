/**
 * @vitest-environment jsdom
 *
 * 更新案内を出すかどうかの判断（docs/SPEC.md §13）。
 *
 * 「新しい Service Worker が控えている」は「画面が古い」とは限らない。
 * 画面遷移はネットワーク優先で、資産名には内容のハッシュが入っているため、
 * オンラインで開いた時点の画面は既に最新版になっている。そこで案内を出すと、
 * 最新版を見ているのに更新を促され、押しても何も変わらない。
 */

import { describe, expect, it } from 'vitest';
import { currentAssetPaths, isSameBuild } from '../src/ui/serviceWorker';

const BASE = '/Business-Days-Schedule/';

/** 画面が読み込んでいる資産を持つ文書を作る。 */
function documentWith(...paths: string[]): Document {
  const doc = document.implementation.createHTMLDocument('t');
  const base = doc.createElement('base');
  base.setAttribute('href', `${globalThis.location.origin}${BASE}`);
  doc.head.append(base);
  for (const path of paths) {
    if (path.endsWith('.css')) {
      const link = doc.createElement('link');
      link.setAttribute('rel', 'stylesheet');
      link.setAttribute('href', path);
      doc.head.append(link);
    } else {
      const script = doc.createElement('script');
      script.setAttribute('src', path);
      doc.head.append(script);
    }
  }
  return doc;
}

describe('currentAssetPaths', () => {
  it('script と stylesheet の絶対パスを拾う', () => {
    const doc = documentWith('assets/index-abc.js', 'assets/index-abc.css');
    expect(currentAssetPaths(doc)).toEqual([
      `${BASE}assets/index-abc.js`,
      `${BASE}assets/index-abc.css`,
    ]);
  });

  it('別のサイトの資産は判断材料にしない', () => {
    const doc = documentWith('assets/index-abc.js');
    const script = doc.createElement('script');
    script.setAttribute('src', 'https://cdn.example.test/x.js');
    doc.head.append(script);
    expect(currentAssetPaths(doc)).toEqual([`${BASE}assets/index-abc.js`]);
  });
});

describe('isSameBuild', () => {
  const manifest = [
    BASE,
    `${BASE}index.html`,
    `${BASE}assets/index-abc.js`,
    `${BASE}assets/index-abc.css`,
  ];

  it('画面の資産がすべて含まれていれば同じ版', () => {
    // ここで案内を出すと、最新版を見ているのに更新を促すことになる。
    expect(isSameBuild([`${BASE}assets/index-abc.js`, `${BASE}assets/index-abc.css`], manifest)).toBe(
      true,
    );
  });

  it('1つでも違えば別の版', () => {
    // 資産名にハッシュが入っているので、中身が変われば必ず名前が変わる。
    expect(isSameBuild([`${BASE}assets/index-old.js`], manifest)).toBe(false);
  });

  it('一部だけ新しくても別の版として扱う', () => {
    expect(
      isSameBuild([`${BASE}assets/index-abc.js`, `${BASE}assets/index-old.css`], manifest),
    ).toBe(false);
  });

  it('判断材料が無ければ「同じとは言えない」とする', () => {
    // 黙って切り替えるより、案内を出すほうが害が小さい。
    expect(isSameBuild([], manifest)).toBe(false);
  });

  it('一覧が絶対 URL でも比べられる', () => {
    const absolute = manifest.map((entry) => `${globalThis.location.origin}${entry}`);
    expect(isSameBuild([`${BASE}assets/index-abc.js`], absolute)).toBe(true);
  });
});
