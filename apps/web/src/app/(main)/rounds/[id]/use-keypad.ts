import { useCallback, useEffect, useRef, useState } from "react";
import type { Pointer } from "./scorecard-input";
import { distanceNumber } from "./scorecard-scoring";
import type { Distance } from "./scorecard-types";

// テンキーは中身のキー数が距離の的ごとに変わるため実測高さを使う。この値は
// ResizeObserverが初回計測を終えるまでの暫定値。
const KEYPAD_HEIGHT_FALLBACK = 220;
// 格納ボタンがテンキー本体の上にはみ出す高さ（-top-12 = 3rem = 48px。右端の点数キーと同じ高さ）。
export const KEYPAD_TOGGLE_OVERHANG = 48;

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

// keypadOpen（=position有無）の変化をそのままアンマウントすると格納
// アニメーションが再生できないため、トランジション終了後に実際に
// アンマウントするまでの間だけmountedをtrueに保つ。
function useKeypadPresence(open: boolean) {
  const [keypadMounted, setKeypadMounted] = useState(open);
  const [keypadVisible, setKeypadVisible] = useState(open);
  const rafRef = useRef(0);
  useEffect(() => {
    if (open) {
      setKeypadMounted(true);
      // マウント直後の1フレーム目でtrueにするとブラウザがtranslate-y-fullを描画
      // する前に遷移先の状態へ変わってしまいアニメーションしないため、
      // 1フレーム待ってから変更する。
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => setKeypadVisible(true));
        rafRef.current = raf2;
      });
      rafRef.current = raf1;
      return () => cancelAnimationFrame(rafRef.current);
    }

    setKeypadVisible(false);
    const timeout = setTimeout(() => setKeypadMounted(false), 200);
    return () => clearTimeout(timeout);
  }, [open]);
  return { keypadMounted, keypadVisible, setKeypadMounted };
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

// 指している矢を、テンキーに隠れない位置までスクロールして見せる。
function useScrollToPointer(
  pointer: Pointer,
  distances: Distance[],
  keypadInset: number,
) {
  // pointerとdistancesは描画のたびに作り直されるため、依存に入れると、利用者がスクロールした位置を入力位置へ戻してしまう。
  // 指す位置とテンキーの高さだけを契機にし、最新の値は参照から読む。
  const pointerKey = pointer
    ? `${pointer.distanceId}:${pointer.endNumber}`
    : null;
  const scrollTargetRef = useRef({ pointer, distances });
  scrollTargetRef.current = { pointer, distances };
  // biome-ignore lint/correctness/useExhaustiveDependencies: pointerKeyとkeypadInsetだけを契機にする
  useEffect(() => {
    const { pointer, distances } = scrollTargetRef.current;
    if (!pointer) return;
    const testId = `end-row-${distanceNumber(distances, pointer.distanceId)}-${pointer.endNumber}`;
    const cell = document.querySelector(`[data-testid="${testId}"]`);
    const container = cell?.closest<HTMLElement>(".overflow-y-auto");
    if (!cell || !container) return;

    // 矢を指せば必ずテンキーが開く前提のため、開閉状態に関わらず常に
    // テンキー分の高さが隠れることを見込んでスクロール位置を計算する
    // （高さ確保用の透明な枠は常にkeypadHeight分の領域を占有している）。
    // 横向きではテンキーは横に並ぶ側パネルで、keypadHeightは列いっぱいに
    // 伸びたパネル自身の高さ（コンテンツと無関係な値）になり、コンテンツを
    // 覆い隠すことも無いため、この補正は縦向き（isLandscape=false、
    // ボトムシート表示時）でのみ適用する。
    const margin = 16;
    const cellRect = cell.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const visibleBottom = containerRect.bottom - keypadInset - margin;

    let delta = 0;
    if (cellRect.bottom > visibleBottom) {
      delta = cellRect.bottom - visibleBottom;
    } else if (cellRect.top < containerRect.top + margin) {
      delta = cellRect.top - (containerRect.top + margin);
    }

    if (delta !== 0) {
      container.scrollBy({ top: delta, behavior: "smooth" });
    }
  }, [pointerKey, keypadInset]);
}

// 玉と空白のボタンだけフォーカスを外す。無条件にblurすると、キーパッド外の
// 他の入力欄（RoundConfigPanel等）へフォーカスした瞬間にも外れてしまう。
function blurShotButtons() {
  const active = document.activeElement as HTMLElement | null;
  const testId = active?.dataset.testid;
  if (
    testId?.startsWith("shot-ball-") ||
    testId?.startsWith("end-blank-") ||
    testId?.startsWith("end-slot-")
  ) {
    active?.blur();
  }
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
  const keypadShouldBeOpen = pointer !== null;
  const presence = useKeypadPresence(keypadShouldBeOpen);
  const { keypadHeight, setKeypadNode } = useKeypadHeight();
  const isLandscape = useIsLandscape();
  const pointedDistance =
    pointer && distances.find((d) => d.id === pointer.distanceId);
  const keypadDistance = useLastDistance(pointedDistance);
  useScrollToPointer(
    pointer,
    distances,
    isLandscape ? 0 : keypadHeight + KEYPAD_TOGGLE_OVERHANG,
  );

  const closeKeypad = useCallback(() => {
    // 指している矢を残したままだと輪の表示が消えず、見た目上フォーカスが
    // 外れていないように見えるため外す。
    // これによりkeypadShouldBeOpen（=指している矢の有無）もfalseになり、
    // useKeypadPresenceの格納アニメーション用useEffectが発火する。
    setPointer(null);
    blurShotButtons();
  }, [setPointer]);

  return {
    ...presence,
    keypadShouldBeOpen,
    keypadHeight,
    setKeypadNode,
    isLandscape,
    keypadDistance,
    closeKeypad,
  };
}
