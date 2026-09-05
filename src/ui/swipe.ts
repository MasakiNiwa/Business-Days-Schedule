/**
 * 横スワイプの検出（スマートフォンで月を送るため）。
 *
 * 縦スクロールを邪魔しないよう、横方向がはっきり優勢なときだけ反応する。
 * スワイプの直後にタップ扱いの click が飛んで日付の詳細が開いてしまうため、
 * 1回だけ click を握り潰す。
 */

export type SwipeHandlers = {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
};

/** これ以上動いたらスワイプとみなす距離（px）。 */
const DISTANCE_THRESHOLD = 60;
/** 横移動が縦移動のこの倍率を超えたときだけ、横スワイプと判断する。 */
const DIRECTION_RATIO = 1.5;
/** これより長い操作はスワイプとみなさない（ゆっくりした選択操作との誤認を防ぐ）。 */
const TIME_LIMIT_MS = 800;

export function attachHorizontalSwipe(element: HTMLElement, handlers: SwipeHandlers): void {
  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let tracking = false;

  element.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) {
        tracking = false;
        return;
      }
      const touch = event.touches[0];
      if (touch === undefined) return;
      startX = touch.clientX;
      startY = touch.clientY;
      startedAt = Date.now();
      tracking = true;
    },
    { passive: true },
  );

  element.addEventListener(
    'touchend',
    (event) => {
      if (!tracking) return;
      tracking = false;

      const touch = event.changedTouches[0];
      if (touch === undefined) return;
      if (Date.now() - startedAt > TIME_LIMIT_MS) return;

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < DISTANCE_THRESHOLD) return;
      if (Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) return;

      // 直後の click（＝タップ扱い）を1回だけ止める。日付の詳細が開くのを防ぐ。
      const swallow = (clickEvent: Event): void => {
        clickEvent.stopPropagation();
        clickEvent.preventDefault();
      };
      element.addEventListener('click', swallow, { capture: true, once: true });
      // スワイプで click が発生しなかった場合に備えて、リスナーを残さず片付ける。
      globalThis.setTimeout(() => {
        element.removeEventListener('click', swallow, { capture: true });
      }, 400);

      // 左へ払う＝次の月、右へ払う＝前の月。紙をめくる向きに合わせる。
      if (dx < 0) handlers.onSwipeLeft();
      else handlers.onSwipeRight();
    },
    { passive: true },
  );
}
