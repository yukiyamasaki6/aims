const MARGIN = 16;
// サブピクセルの誤差で、固定表示やテンキーに接する見えている行を動かさないための許容。
const TOLERANCE = 1;

// 見えるべき範囲（固定表示の下端から領域の下端まで）に矢の行を収めるための
// スクロール量。下に隠れる場合を優先し、上に隠れる場合はそれに次ぐ。
// 許容の範囲で接している行は見えているものとして動かさない。
export function revealDelta({
  cellTop,
  cellBottom,
  visibleTop,
  visibleBottom,
}: {
  cellTop: number;
  cellBottom: number;
  visibleTop: number;
  visibleBottom: number;
}): number {
  if (cellBottom > visibleBottom + TOLERANCE) return cellBottom - visibleBottom;
  if (cellTop < visibleTop - TOLERANCE) return cellTop - visibleTop;
  return 0;
}

// 領域の中の固定表示（data-sticky-inset）の下端のうち最も下のもの。
// 別の距離の小計は、その距離の行より上で外れていて対象の行を隠さないため除く。
function stickyBottom(
  container: HTMLElement,
  cell: Element,
  fallback: number,
): number {
  const ownDistance = cell.closest('[data-testid^="distance-summary-"]');
  let bottom = fallback;
  for (const el of container.querySelectorAll("[data-sticky-inset]")) {
    const distance = el.closest('[data-testid^="distance-summary-"]');
    if (distance !== null && distance !== ownDistance) continue;
    bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  }
  return bottom;
}

// 指している矢の行を、テンキーと固定表示のどちらにも隠れない位置までスクロールして見せる。
// スクロール領域（<main>）の矩形が、ヘッダーの下から完了の帯・テンキーの上端までになる。
// bottomOverlayは、領域の下端に重なる縦向きの格納ボタンの高さ（横向きと閉じているときは0）。
// 上側は領域の中の固定表示（ラウンドの結果、距離の小計）だけを実測で見込み、
// 固定表示に余白を付けず、接する行は動かさない。
export function scrollPointerIntoView(
  testId: string,
  bottomOverlay: number,
): void {
  const cell = document.querySelector(`[data-testid="${testId}"]`);
  const container = cell?.closest<HTMLElement>(".overflow-y-auto");
  if (!cell || !container) return;

  const cellRect = cell.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const delta = revealDelta({
    cellTop: cellRect.top,
    cellBottom: cellRect.bottom,
    visibleTop: Math.max(
      containerRect.top + MARGIN,
      stickyBottom(container, cell, containerRect.top),
    ),
    visibleBottom: containerRect.bottom - bottomOverlay - MARGIN,
  });
  if (delta !== 0) {
    container.scrollBy({ top: delta, behavior: "smooth" });
  }
}
