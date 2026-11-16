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

  it("既定は幅768px以上に一致せず、wide:trueで一致し、他のqueryには影響しない", () => {
    // Given
    const matches = () => ({
      wide: window.matchMedia("(min-width: 768px)").matches,
      other: window.matchMedia("(prefers-color-scheme: dark)").matches,
    });

    // When
    const narrow = installFakeViewport();
    const byDefault = matches();
    narrow.restore();
    const wide = installFakeViewport({ wide: true });
    const withWide = matches();
    wide.restore();

    // Then
    expect(byDefault).toEqual({ wide: false, other: false });
    expect(withWide).toEqual({ wide: true, other: false });
  });

  it("setWideでmatchesが変わり、changeの購読者へ通知する。解除した購読者へは通知しない", () => {
    // Given
    const viewport = installFakeViewport();
    const query = window.matchMedia("(min-width: 768px)");
    const kept = vi.fn();
    const removed = vi.fn();
    query.addEventListener("change", kept);
    query.addEventListener("change", removed);
    query.removeEventListener("change", removed);

    // When
    viewport.setWide(true);
    const matches = window.matchMedia("(min-width: 768px)").matches;
    viewport.restore();

    // Then
    expect(matches).toBe(true);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });
  it("向きの変更は専用購読へ通知し幅の判定と動きを減らす設定を変えない", () => {
    // Given
    const viewport = installFakeViewport({ reducedMotion: true });
    const query = window.matchMedia("(orientation: landscape)");
    const changed = vi.fn();
    const removed = vi.fn();
    const wide = vi.fn();
    query.addEventListener("change", changed);
    query.addEventListener("change", removed);
    query.removeEventListener("change", removed);
    window.matchMedia("(min-width: 768px)").addEventListener("change", wide);

    // When
    viewport.setLandscape(true);
    const horizontal = query.matches;
    viewport.setLandscape(false);
    const portrait = query.matches;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    viewport.restore();
    viewport.setLandscape(true);

    // Then
    expect([horizontal, portrait, reduced]).toEqual([true, false, true]);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(removed).not.toHaveBeenCalled();
    expect(wide).not.toHaveBeenCalled();
  });
});
