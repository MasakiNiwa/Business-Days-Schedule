/**
 * @vitest-environment jsdom
 *
 * 横スワイプ。縦スクロールを邪魔しないこと、スワイプ直後のタップで
 * 日付の詳細が開いてしまわないことが要点。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachHorizontalSwipe } from '../src/ui/swipe';

type Point = { x: number; y: number };

/** jsdom には TouchEvent が無いので、必要な形だけ持つイベントを組み立てる。 */
function touchEvent(type: string, points: Point[]): Event {
  const event = new Event(type, { bubbles: true });
  const list = points.map((point) => ({ clientX: point.x, clientY: point.y }));
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : list });
  Object.defineProperty(event, 'changedTouches', { value: list });
  return event;
}

function setup(): {
  element: HTMLElement;
  left: ReturnType<typeof vi.fn>;
  right: ReturnType<typeof vi.fn>;
} {
  const element = document.createElement('div');
  document.body.append(element);
  const left = vi.fn();
  const right = vi.fn();
  attachHorizontalSwipe(element, { onSwipeLeft: left, onSwipeRight: right });
  return { element, left, right };
}

function swipe(element: HTMLElement, from: Point, to: Point): void {
  element.dispatchEvent(touchEvent('touchstart', [from]));
  element.dispatchEvent(touchEvent('touchend', [to]));
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('attachHorizontalSwipe', () => {
  it('左へ払うと onSwipeLeft', () => {
    const { element, left, right } = setup();
    swipe(element, { x: 300, y: 200 }, { x: 200, y: 205 });
    expect(left).toHaveBeenCalledOnce();
    expect(right).not.toHaveBeenCalled();
  });

  it('右へ払うと onSwipeRight', () => {
    const { element, left, right } = setup();
    swipe(element, { x: 100, y: 200 }, { x: 220, y: 195 });
    expect(right).toHaveBeenCalledOnce();
    expect(left).not.toHaveBeenCalled();
  });

  it('移動が小さければ反応しない（タップと区別する）', () => {
    const { element, left, right } = setup();
    swipe(element, { x: 200, y: 200 }, { x: 230, y: 200 });
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it('縦方向が優勢なら反応しない（スクロールを邪魔しない）', () => {
    const { element, left, right } = setup();
    swipe(element, { x: 200, y: 100 }, { x: 120, y: 400 });
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it('指が2本なら反応しない（ピンチと区別する）', () => {
    const { element, left, right } = setup();
    element.dispatchEvent(touchEvent('touchstart', [{ x: 300, y: 200 }, { x: 320, y: 220 }]));
    element.dispatchEvent(touchEvent('touchend', [{ x: 200, y: 205 }]));
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it('スワイプ直後の click を1回だけ握り潰す', () => {
    const { element } = setup();
    const child = document.createElement('button');
    element.append(child);
    const onClick = vi.fn();
    element.addEventListener('click', onClick);

    swipe(element, { x: 300, y: 200 }, { x: 200, y: 200 });
    child.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).not.toHaveBeenCalled();

    // 2回目以降は通常どおり通す。
    child.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('スワイプでなければ click を止めない', () => {
    const { element } = setup();
    const onClick = vi.fn();
    element.addEventListener('click', onClick);
    swipe(element, { x: 200, y: 200 }, { x: 210, y: 200 });
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('握り潰しリスナーは時間が経てば片付けられる', () => {
    vi.useFakeTimers();
    const { element } = setup();
    const onClick = vi.fn();
    element.addEventListener('click', onClick);

    swipe(element, { x: 300, y: 200 }, { x: 200, y: 200 });
    vi.advanceTimersByTime(500);
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
