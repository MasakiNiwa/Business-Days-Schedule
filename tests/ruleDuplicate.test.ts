/**
 * @vitest-environment jsdom
 *
 * ルールの複製（docs/SPEC.md §8.4）。
 *
 * 「25日締め」と「末日締め」のように、1か所だけ違うルールを何本も作ることが多い。
 * 一から組み直させると、営業日カレンダーやグループの指定を写し忘れる。
 */

import { describe, expect, it, vi } from 'vitest';
import { renderRuleList } from '../src/ui/RuleList';
import type { RuleListHandlers } from '../src/ui/RuleList';
import { createRule } from '../src/core/storage';
import type { Rule } from '../src/types';
import { companyCalendarDef, makeRule } from './helpers';

const calendars = new Map([[companyCalendarDef.id, companyCalendarDef]]);

function open(handlers: Partial<RuleListHandlers> = {}): {
  root: HTMLElement;
  handlers: RuleListHandlers;
} {
  const full: RuleListHandlers = {
    onLoadSamples: vi.fn(),
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onToggle: vi.fn(),
    onOpenSettings: vi.fn(),
    onRenameGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    onClose: vi.fn(),
    ...handlers,
  };
  const rule = makeRule({ id: 'salary', title: '給与振込', calendarId: companyCalendarDef.id });
  return { root: renderRuleList([rule], calendars, full), handlers: full };
}

describe('複製', () => {
  it('一覧の各行に「複製」を出す', () => {
    const { root } = open();
    const labels = [...root.querySelectorAll('li.rule button')].map((n) => n.textContent);
    expect(labels).toContain('複製');
  });

  it('押すとそのルールの id を渡す', () => {
    const onDuplicate = vi.fn();
    const { root } = open({ onDuplicate });
    [...root.querySelectorAll('button')]
      .find((node) => node.textContent === '複製')
      ?.dispatchEvent(new MouseEvent('click'));
    expect(onDuplicate).toHaveBeenCalledWith('salary');
  });
});

describe('複製した内容', () => {
  /**
   * app.ts の startDuplicate と同じ組み立て。
   * 既定値ごと被せると、写したはずの営業日カレンダーや繰り返しまで
   * 初期状態へ戻ってしまう（実際に一度そうなった）。
   */
  const duplicate = (source: Rule): Rule => {
    const copy = structuredClone(source);
    const fresh = createRule({});
    return {
      ...copy,
      id: fresh.id,
      createdAt: fresh.createdAt,
      updatedAt: fresh.updatedAt,
      title: `${source.title}のコピー`,
      notices: copy.notices.map(({ id: _id, ...notice }) => notice),
    };
  };

  const source = makeRule({
    id: 'salary',
    title: '給与振込',
    calendarId: 'bank',
    group: '支払',
    color: 'green',
    recurrence: { type: 'monthlyByDay', interval: 1, days: [25], overflow: 'clamp' },
    adjust: { mode: 'prev', keepInMonth: true },
    notices: [{ id: 'n0', label: '振込データ作成', timing: { kind: 'offset', offset: -3, unit: 'business' } }],
  });

  it('設定はそのまま写す', () => {
    const copy = duplicate(source);
    expect(copy.calendarId).toBe('bank');
    expect(copy.group).toBe('支払');
    expect(copy.color).toBe('green');
    expect(copy.recurrence).toEqual(source.recurrence);
    expect(copy.adjust).toEqual(source.adjust);
  });

  it('名前はコピーと分かるようにする', () => {
    expect(duplicate(source).title).toBe('給与振込のコピー');
  });

  it('識別子は作り直す（元と同じ予定として扱われないように）', () => {
    expect(duplicate(source).id).not.toBe(source.id);
  });

  it('前後の予定の識別子も作り直す', () => {
    // 同じ id のままだと、書き出したときに元の予定を上書きしてしまう。
    expect(duplicate(source).notices[0]?.id).toBeUndefined();
    expect(duplicate(source).notices[0]?.label).toBe('振込データ作成');
  });
});
