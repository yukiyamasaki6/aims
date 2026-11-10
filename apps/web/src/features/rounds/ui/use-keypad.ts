import { useCallback, useEffect, useRef, useState } from "react";
import type { Distance } from "../domain/scorecard-types";
import type { Pointer } from "../domain/shot-pointer";
import { scrollPointerIntoView } from "./scroll-to-pointer";

// テンキーは中身のキー数が距離の的ごとに変わるため実測高さを使う。この値は
// ResizeObserverが初回計測を終えるまでの暫定値。
const KEYPAD_HEIGHT_FALLBACK = 220;
// 格納ボタンがテンキー本体の上にはみ出す高さ（-top-12 = 3rem = 48px。右端の点数キーと同じ高さ）。
const KEYPAD_TOGGLE_OVERHANG = 48;

// 横向きではテンキーをスコア領域の隣に並ぶ側パネルとして<main>の外側に、
// 縦向きでは<main>内蔵のボトムシートとして描画を完全に分ける（CSSの
// 出し分けではなくJSで判定し、どちらか一方だけをマウントする）。これに
// より、縦向きのボトムシートはposition:fixedにする必要が無くなり、常に
// <main>の内側（＝レフトパネルより右のコンテンツ領域）に収まるため、
// レフトパネルの実占有幅を気にする必要が一切無くなる。
function useIsLandscape() {
  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(orientation: landscape)");
    const update = () => setIsLandscape(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isLandscape;
}

// 格納アニメーション中もテンキーの中身（点数ボタン）を表示し続けられる
// よう、何も指さなくなった後も直近に指していた矢の距離を保持しておく。
function useLastDistance(pointedDistance: Distance | null | undefined) {
  const lastDistanceRef = useRef<Distance | null>(pointedDistance ?? null);
  if (pointedDistance) lastDistanceRef.current = pointedDistance;
  return pointedDistance ?? lastDistanceRef.current;
}

// テンキーのキー数は距離ごとの的によって変わり、高さも連動する。固定値では
// なく実測値を使うことで、キー数変化時も指した矢へのスクロール計算が崩れない。
function useKeypadHeight() {
  const [keypadHeight, setKeypadHeight] = useState(KEYPAD_HEIGHT_FALLBACK);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const setKeypadNode = useCallback((el: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setKeypadHeight(entry.contentRect.height);
    });
    observer.observe(el);
    resizeObserverRef.current = observer;
  }, []);
  return { keypadHeight, setKeypadNode };
}

// スクロール領域(<main>)の大きさが変わったとき、follow()を呼ぶ。
// 向きの切り替え、窓の大きさ、テンキーの高さ(暫定値から実測値への変化を含む)で変わる。
// 内容全体の高さは見ない。距離の追加・削除などで内容が伸びたときに、利用者が別の場所へスクロールした位置を指す行へ戻してしまうため。
function useFollowOnResize(follow: () => void) {
  return useCallback(
    (element: HTMLElement | null) => {
      if (!element) return;
      const observer = new ResizeObserver(follow);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [follow],
  );
}

// 指している矢の行が、テンキーと固定表示に隠れていれば、隠れない位置までスクロールする。見えていれば動かさない。
// <main>の矩形が帯・テンキーの上端までになる。格納ボタンは重なるため、その分をbottomOverlayで引く。
// 返す関数は安定していて、呼ぶ時点の最新の指す矢とbottomOverlayを参照から読む。
// pointerは描画のたびに作り直されるため、これを効果の依存に入れると、利用者がスクロールした位置を入力位置へ戻してしまう。
function useFollow(pointer: Pointer, bottomOverlay: number) {
  const latestRef = useRef({ pointer, bottomOverlay });
  latestRef.current = { pointer, bottomOverlay };
  return useCallback(() => {
    const { pointer: current, bottomOverlay: overlay } = latestRef.current;
    if (!current) return;
    scrollPointerIntoView(current.distanceId, current.endNumber, overlay);
  }, []);
}

// テンキーの開閉、高さ、向きと、指している矢へのスクロール。
// 指している矢の有無がそのままテンキーの開閉状態であり、別のstateとして二重管理しない。
export function useKeypad({
  pointer,
  distances,
  setPointer,
}: {
  pointer: Pointer;
  distances: Distance[];
  setPointer: (pointer: Pointer) => void;
}) {
  const keypadOpen = pointer !== null;
  const { keypadHeight, setKeypadNode } = useKeypadHeight();
  const isLandscape = useIsLandscape();
  const pointedDistance =
    pointer && distances.find((d) => d.id === pointer.distanceId);
  const keypadDistance = useLastDistance(pointedDistance);
  // 利用者の操作で指す矢を設定するたびに増やし、同じ矢でも同じエンド内の移動でもスクロールを促す。
  const [followKey, setFollowKey] = useState(0);
  const follow = useFollow(pointer, isLandscape ? 0 : KEYPAD_TOGGLE_OVERHANG);
  // 追従の契機は2系統で、処理はどちらもfollow()。
  // (a) 利用者の操作で指す矢を設定したとき(マウント時の最初の1回を含む)。他の端末の変化で指す矢が直されても、追従しない。
  // biome-ignore lint/correctness/useExhaustiveDependencies: followKeyだけを契機にする
  useEffect(follow, [followKey]);
  // (b) 配置が変わったとき。スクロール領域の大きさが変わったとき(向き、窓、テンキーの高さ)と、行の段数が変わったとき(呼び元が`follow`を渡す)。
  const observeContainer = useFollowOnResize(follow);
  const followPointer = useCallback(
    (next: Pointer) => {
      setPointer(next);
      setFollowKey((k) => k + 1);
    },
    [setPointer],
  );

  // 指している矢を外すとkeypadOpen（=指している矢の有無）がfalseになり、テンキーはCSSのtransitionで格納される。
  const closeKeypad = useCallback(() => setPointer(null), [setPointer]);

  return {
    keypadOpen,
    keypadHeight,
    setKeypadNode,
    isLandscape,
    keypadDistance,
    closeKeypad,
    followPointer,
    follow,
    observeContainer,
  };
}
