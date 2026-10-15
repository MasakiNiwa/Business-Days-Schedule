/**
 * 版と公開日（docs/SPEC.md §8.10）。
 *
 * 機能を足したのに版を上げ忘れると、利用者はどの版を見ているのか分からない。
 * 版を上げるときに一緒に直すべき場所が揃っているかを確かめる。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidDateStr } from '../src/core/dateUtil';
import { longVersion } from '../src/core/buildInfo';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')) as {
  version: string;
  releaseDate?: string;
};
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf-8')) as {
  version: string;
};
const readme = readFileSync(resolve(root, 'README.md'), 'utf-8');

describe('版と公開日', () => {
  it('公開日は実在する YYYY-MM-DD', () => {
    expect(pkg.releaseDate).toBeDefined();
    expect(isValidDateStr(pkg.releaseDate ?? '')).toBe(true);
  });

  it('package-lock.json の版が package.json と揃っている', () => {
    expect(lock.version).toBe(pkg.version);
  });

  it('README の「状態」が今の版を名乗っている', () => {
    expect(readme).toContain(`**v${pkg.version}**`);
  });

  it('アプリの日付はビルド日時ではなく公開日', () => {
    const text = longVersion({
      version: '1.2.3',
      releasedAt: '2026-10-07',
      builtAt: '2026-11-30T03:17:00.000Z',
      commit: 'abc1234',
    });
    expect(text).toBe('v1.2.3（2026-10-07 公開 / abc1234）');
    expect(text).not.toContain('2026-11-30');
  });
});
