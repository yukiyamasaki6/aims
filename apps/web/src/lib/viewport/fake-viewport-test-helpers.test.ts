import { describe, expect, it, vi } from "vitest";
import { installFakeViewport } from "./fake-viewport-test-helpers";

describe("installFakeViewport", () => {
  it("指定した状態をブラウザの名前に差し、restoreで元へ戻す", () => {
    // Given
    const original = window.matchMedia;

    // When
    const viewport = installFakeViewport({
      standalone: true,
      virtualKeyboard: true,
      visualViewport: { height: 500, scale: 2 },
      innerHeight: 700,
    });
    const during = {
      standalone: window.matchMedia("(display-mode: standalone)").matches,
      other: window.matchMedia("(prefers-color-scheme: dark)").matches,
      keyboard: "virtualKeyboard" in navigator,
      height: window.visualViewport?.height,
      inner: window.innerHeight,
    };
    viewport.restore();

    // Then
    expect(during).toEqual({
      standalone: true,
      other: false,
      keyboard: true,
      height: 500,
      inner: 700,
    });
    expect(window.matchMedia).toBe(original);
    expect("virtualKeyboard" in navigator).toBe(false);
    expect(window.visualViewport).toBeUndefined();
  });

  it("既定は、タブでキーボード無し、visualViewport無しである", () => {
    // Given

    // When
    const viewport = installFakeViewport();
    const state = {
      standalone: window.matchMedia("(display-mode: standalone)").matches,
      keyboard: "virtualKeyboard" in navigator,
      visualViewport: window.visualViewport,
    };
    viewport.restore();

    // Then
    expect(state).toEqual({
      standalone: false,
      keyboard: false,
      visualViewport: undefined,
    });
  });

  it("対象の購読を数え、解除すると減る。高さを替えて通知を発火できる", () => {
    // Given
    const viewport = installFakeViewport({
      visualViewport: { height: 500, scale: 1 },
    });
    const onResize = vi.fn();
    const onOther = vi.fn();

    // When
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    document.addEventListener("click", onOther);
    const counted = viewport.subscriptions();
    viewport.setVisualViewportHeight(300);
    viewport.setInnerHeight(900);
    viewport.fireVisualViewportResize();
    window.removeEventListener("resize", onResize);
    window.visualViewport?.removeEventListener("resize", onResize);
    document.removeEventListener("click", onOther);
    const remaining = viewport.subscriptions();
    const state = [window.visualViewport?.height, window.innerHeight];
    viewport.restore();

    // Then
    expect(counted).toBe(2);
    expect(remaining).toBe(0);
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(state).toEqual([300, 900]);
  });
});
