import { afterEach, describe, expect, it, vi } from "vitest";
import { followRowKey, scrollPointerIntoView } from "./scroll-to-pointer";

// 公開の関数から検証する。jsdomは寸法を測れないため、要素の矩形をスタブで与える。
// 領域は上下に16の余白を持つため、見えるべき範囲は100〜500になる。
function rectOf(top: number, bottom: number) {
  return { top, bottom } as DOMRect;
}

function mountRow(cell: { top: number; bottom: number }) {
  const container = document.createElement("main");
  container.setAttribute("data-follow-container", "");
  const row = document.createElement("div");
  row.setAttribute("data-follow-row", followRowKey("d-1", 1));
  container.append(row);
  document.body.append(container);
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rectOf(84, 516));
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue(
    rectOf(cell.top, cell.bottom),
  );
  const scrollBy = vi.fn();
  container.scrollBy = scrollBy;
  return scrollBy;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("scrollPointerIntoView", () => {
  it("行が見える範囲に収まる場合は動かさない", () => {
    // Given
    const scrollBy = mountRow({ top: 200, bottom: 240 });

    // When
    scrollPointerIntoView("d-1", 1, 0);

    // Then
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("行が見える範囲の端にちょうど接する場合は動かさない", () => {
    // Given
    const scrollBy = mountRow({ top: 100, bottom: 500 });

    // When
    scrollPointerIntoView("d-1", 1, 0);

    // Then
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("行が下に1はみ出す場合は、許容の範囲として動かさない", () => {
    // Given
    const scrollBy = mountRow({ top: 461, bottom: 501 });

    // When
    scrollPointerIntoView("d-1", 1, 0);

    // Then
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("行が下に2はみ出す場合は、はみ出した分だけ下へスクロールする", () => {
    // Given
    const scrollBy = mountRow({ top: 462, bottom: 502 });

    // When
    scrollPointerIntoView("d-1", 1, 0);

    // Then
    expect(scrollBy).toHaveBeenCalledWith({ top: 2, behavior: "smooth" });
  });

  it("行が上に1はみ出す場合は、許容の範囲として動かさない", () => {
    // Given
    const scrollBy = mountRow({ top: 99, bottom: 139 });

    // When
    scrollPointerIntoView("d-1", 1, 0);

    // Then
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("行が上に2はみ出す場合は、はみ出した分だけ上へスクロールする", () => {
    // Given
    const scrollBy = mountRow({ top: 98, bottom: 138 });

    // When
    scrollPointerIntoView("d-1", 1, 0);

    // Then
    expect(scrollBy).toHaveBeenCalledWith({ top: -2, behavior: "smooth" });
  });

  it("行が上下の両方にはみ出す場合は、下に隠れる分を優先する", () => {
    // Given
    const scrollBy = mountRow({ top: 50, bottom: 550 });

    // When
    scrollPointerIntoView("d-1", 1, 0);

    // Then
    expect(scrollBy).toHaveBeenCalledWith({ top: 50, behavior: "smooth" });
  });
});
