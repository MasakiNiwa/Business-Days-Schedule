/**
 * docs/SPEC.md §7.3 の機械的な担保。
 *
 * ローカル時刻系の Date API を src/core/ で使うと、実行環境のタイムゾーンによって
 * 日付が1日ずれる。dateUtil.ts に閉じ込めた UTC ベースの演算だけを使うよう、
 * 禁止 API の混入をここで検出する。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(import.meta.dirname, '../src');

/** dateUtil.ts だけは UTC 系 API を直接使うため対象外にする。 */
const EXEMPT = new Set(['core/dateUtil.ts']);

const BANNED: { pattern: RegExp; reason: string }[] = [
  { pattern: /\.getFullYear\s*\(/, reason: 'getFullYear はローカル時刻系です。dateUtil の yearOf を使ってください' },
  { pattern: /\.getMonth\s*\(/, reason: 'getMonth はローカル時刻系です。dateUtil の monthOf を使ってください' },
  { pattern: /\.getDate\s*\(/, reason: 'getDate はローカル時刻系です。dateUtil の dayOf を使ってください' },
  { pattern: /\.getDay\s*\(/, reason: 'getDay はローカル時刻系です。dateUtil の weekdayOf を使ってください' },
  { pattern: /\.setFullYear\s*\(|\.setMonth\s*\(|\.setDate\s*\(/, reason: 'set* はローカル時刻系です。dateUtil の addDays / addMonths を使ってください' },
  { pattern: /new Date\s*\(\s*['"`]/, reason: 'new Date(文字列) は解釈がゾーン依存です。dateUtil の parseDate を使ってください' },
];

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return collectTsFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('ローカル時刻系 Date API の禁止', () => {
  it('src 配下で使われていない', () => {
    const violations: string[] = [];
    for (const path of collectTsFiles(SRC_DIR)) {
      const relativePath = relative(SRC_DIR, path).replace(/\\/g, '/');
      if (EXEMPT.has(relativePath)) continue;
      const lines = readFileSync(path, 'utf-8').split('\n');
      lines.forEach((line, index) => {
        for (const { pattern, reason } of BANNED) {
          if (pattern.test(line)) {
            violations.push(`${relativePath}:${index + 1}  ${line.trim()}\n    → ${reason}`);
          }
        }
      });
    }
    expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
  });
});
