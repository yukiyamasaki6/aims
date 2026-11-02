import { type RefObject, useLayoutEffect, useRef } from "react";

// 記録済みの玉が並び直る動きの長さ。
const REORDER_DURATION_MS = 200;

// 記録済みの玉と仮の矢が並び直る様子を、前の位置から今の位置へ動かして見せる。
// 玉は矢のIDで、輪は玉の領域ごとに追う。仮の矢は、前の輪の位置から動かす。前の輪が玉に付いていたときは、その玉が消えたときだけ動かす。
// 同じエンドの中で位置が変わったものだけを動かす。動きを減らす設定では動かさない。
// 場所の幅は玉の領域の幅と列の数で決まるため、どちらかが前の描画から変わったとき(開いた直後の幅の測定、回転や窓の大きさの変更)は動かさない。
// 前の位置はレイアウト上の位置で覚える。動いている途中で次の反映が来たときは、その動きを止め、途中の変形を足した見た目の位置から動かし直す。
type BallPosition = {
  parent: Element | null;
  parentWidth: number;
  parentColumns: string;
  x: number;
  y: number;
};

// 輪の位置は、玉のボタンと空白のボタンの幅が違うため中心で比べる。
type RingPosition = {
  parentWidth: number;
  parentColumns: string;
  x: number;
  y: number;
  shotId: string | null;
};

// 要素の動いている動きを止め、止める前の見た目の位置との差(動きの途中の変形)を返す。動いていなければ(0, 0)とする。
function stopMoving(
  element: Element,
  moving: WeakMap<Element, Animation>,
): { x: number; y: number } {
  const animation = moving.get(element);
  moving.delete(element);
  if (animation?.playState !== "running") return { x: 0, y: 0 };
  const shown = element.getBoundingClientRect();
  animation.cancel();
  const settled = element.getBoundingClientRect();
  return { x: shown.left - settled.left, y: shown.top - settled.top };
}

// 要素を、レイアウト上の差(dx, dy)に動いている途中の変形を足した位置から、今の位置へ動かす。
function moveFrom(
  element: HTMLElement,
  dx: number,
  dy: number,
  moving: WeakMap<Element, Animation>,
) {
  const offset = stopMoving(element, moving);
  const x = dx + offset.x;
  const y = dy + offset.y;
  if (x === 0 && y === 0) return;
  const animation = element.animate(
    [
      { transform: `translate(${x}px, ${y}px)` },
      { transform: "translate(0, 0)" },
    ],
    { duration: REORDER_DURATION_MS, easing: "ease-out" },
  );
  // テストのモックのように値を返さない環境では覚えない。
  if (animation) moving.set(element, animation);
}

// 玉の並びの枠(親、幅、列)が変わったか。変わったときは、位置の差を動きにしない。
function layoutChanged(before: BallPosition, position: BallPosition): boolean {
  return (
    before.parent !== position.parent ||
    before.parentWidth !== position.parentWidth ||
    before.parentColumns !== position.parentColumns
  );
}

// 玉を前の位置から動かし、新しい位置を返す。
function animateBalls(
  root: HTMLElement,
  previous: Map<string, BallPosition>,
  moving: WeakMap<Element, Animation>,
  reduced: boolean,
): Map<string, BallPosition> {
  const next = new Map<string, BallPosition>();
  for (const element of root.querySelectorAll<HTMLElement>("[data-shot-id]")) {
    const id = element.dataset.shotId as string;
    const position: BallPosition = {
      parent: element.parentElement,
      parentWidth: element.parentElement?.clientWidth ?? 0,
      parentColumns: element.parentElement?.style.gridTemplateColumns ?? "",
      x: element.offsetLeft,
      y: element.offsetTop,
    };
    next.set(id, position);
    const before = previous.get(id);
    if (!before || typeof element.animate !== "function") continue;
    if (reduced || layoutChanged(before, position)) {
      stopMoving(element, moving);
      continue;
    }
    const dx = before.x - position.x;
    const dy = before.y - position.y;
    // 位置が変わらないものの動きは止めない。
    if (dx === 0 && dy === 0) continue;
    moveFrom(element, dx, dy, moving);
  }
  return next;
}

// 輪の、親の中での位置。
function ringPositionOf(
  element: HTMLElement,
  parent: HTMLElement,
): RingPosition {
  return {
    parentWidth: parent.clientWidth,
    parentColumns: parent.style.gridTemplateColumns,
    x: element.offsetLeft + element.offsetWidth / 2,
    y: element.offsetTop + element.offsetHeight / 2,
    shotId: element.dataset.shotId ?? null,
  };
}

// 新しい矢の輪を、前の位置から動かす。ballsは玉の新しい位置。
function animateNewRing(
  element: HTMLElement,
  ring: RingPosition,
  before: RingPosition | undefined,
  balls: Map<string, BallPosition>,
  moving: WeakMap<Element, Animation>,
  reduced: boolean,
) {
  // 押せる範囲を動かさないよう、空白のボタンでなく中の輪を動かす。
  const mark = element.querySelector<HTMLElement>(
    '[data-testid="provisional-shot"]',
  );
  if (!mark || !before || typeof mark.animate !== "function") return;
  if (
    reduced ||
    before.parentWidth !== ring.parentWidth ||
    before.parentColumns !== ring.parentColumns
  ) {
    stopMoving(mark, moving);
    return;
  }
  if (before.shotId !== null && balls.has(before.shotId)) return;
  const dx = before.x - ring.x;
  const dy = before.y - ring.y;
  if (dx === 0 && dy === 0) return;
  moveFrom(mark, dx, dy, moving);
}

// 仮の矢の輪を前の位置から動かし、新しい位置を返す。
function animateRings(
  root: HTMLElement,
  previousRings: Map<Element, RingPosition>,
  balls: Map<string, BallPosition>,
  moving: WeakMap<Element, Animation>,
  reduced: boolean,
): Map<Element, RingPosition> {
  const nextRings = new Map<Element, RingPosition>();
  for (const element of root.querySelectorAll<HTMLElement>("[data-ring]")) {
    const parent = element.parentElement;
    if (!parent) continue;
    const ring = ringPositionOf(element, parent);
    nextRings.set(parent, ring);
    if (element.dataset.ring !== "new") continue;
    animateNewRing(
      element,
      ring,
      previousRings.get(parent),
      balls,
      moving,
      reduced,
    );
  }
  return nextRings;
}

export function useReorderAnimation(rootRef: RefObject<HTMLElement | null>) {
  const previous = useRef(new Map<string, BallPosition>());
  const previousRings = useRef(new Map<Element, RingPosition>());
  const moving = useRef(new WeakMap<Element, Animation>());
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const next = animateBalls(root, previous.current, moving.current, reduced);
    previous.current = next;
    previousRings.current = animateRings(
      root,
      previousRings.current,
      next,
      moving.current,
      reduced,
    );
  });
}
