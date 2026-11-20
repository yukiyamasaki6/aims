import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FakeViewport,
  installFakeViewport,
} from "@/lib/viewport/fake-viewport-test-helpers";
import { useAppHeight } from "./use-app-height";

const root = document.documentElement.style;

function appHeight() {
  return root.getPropertyValue("--app-height");
}

let viewport: FakeViewport;

beforeEach(() => {
  vi.useFakeTimers();
  root.setProperty("--app-height", "100dvh");
});

afterEach(() => {
  viewport.restore();
  vi.useRealTimers();
});

describe("スタンドアロンでvirtualKeyboardがある環境", () => {
  const standalone = { standalone: true, virtualKeyboard: true };

  it("開くと、innerHeightをpxで書く", () => {
    // Given
    viewport = installFakeViewport({ ...standalone, innerHeight: 640 });

    // When
    renderHook(() => useAppHeight());

    // Then
    expect(appHeight()).toBe("640px");
  });

  it("visualViewportがあっても、その高さや拡大率は使わずinnerHeightを書く", () => {
    // Given
    // visualViewportをinnerHeightと食い違う値にして、読んでいないことを確かめる。
    viewport = installFakeViewport({
      ...standalone,
      innerHeight: 700,
      visualViewport: { height: 300, scale: 2 },
    });

    // When
    renderHook(() => useAppHeight());

    // Then
    expect(appHeight()).toBe("700px");
  });

  it("visualViewportのresize(キーボード展開相当)では、書き直さない", () => {
    // Given
    viewport = installFakeViewport({
      ...standalone,
      innerHeight: 700,
      visualViewport: { height: 700, scale: 1 },
    });
    renderHook(() => useAppHeight());

    // When
    act(() => {
      viewport.setVisualViewportHeight(400);
      viewport.fireVisualViewportResize();
    });

    // Then
    expect(appHeight()).toBe("700px");
  });

  it("windowのresizeで、innerHeightが変わっていれば更新する", () => {
    // Given
    viewport = installFakeViewport({ ...standalone, innerHeight: 700 });
    renderHook(() => useAppHeight());

    // When
    act(() => {
      viewport.setInnerHeight(450);
      window.dispatchEvent(new Event("resize"));
    });

    // Then
    expect(appHeight()).toBe("450px");
  });

  it("時間が経っても、通知なしの変化は書き直さない", () => {
    // Given
    viewport = installFakeViewport({
      ...standalone,
      innerHeight: 700,
      visualViewport: { height: 700, scale: 1 },
    });
    renderHook(() => useAppHeight());

    // When
    viewport.setInnerHeight(650);
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Then
    expect(appHeight()).toBe("700px");
  });

  it.each([
    ["windowのpageshow", window, "pageshow"],
    ["windowのorientationchange", window, "orientationchange"],
    ["documentのvisibilitychange", document, "visibilitychange"],
  ] as const)("%sでは、書き直さない", (_, target, type) => {
    // Given
    viewport = installFakeViewport({
      ...standalone,
      innerHeight: 700,
      visualViewport: { height: 700, scale: 1 },
    });
    renderHook(() => useAppHeight());

    // When
    act(() => {
      viewport.setInnerHeight(450);
      target.dispatchEvent(new Event(type));
    });

    // Then
    expect(appHeight()).toBe("700px");
  });

  it("直前に書いた値との差が0.5px未満なら書かず、0.5px以上なら書く。小数の高さで境界を確かめる", () => {
    // Given
    // 実機の高さは小数になり得るため、0.5pxの境界を小数で確かめる。
    viewport = installFakeViewport({
      ...standalone,
      innerHeight: 600,
    });
    renderHook(() => useAppHeight());
    const change = (height: number) => {
      act(() => {
        viewport.setInnerHeight(height);
        window.dispatchEvent(new Event("resize"));
      });
      return appHeight();
    };

    // When
    const underHalf = change(600.4);
    const overHalf = change(601.5);
    const exactlyHalf = change(602);

    // Then
    expect([underHalf, overHalf, exactlyHalf]).toEqual([
      "600px",
      "601.5px",
      "602px",
    ]);
  });

  it("アンマウントで全ての購読を外し、以後は書かない", () => {
    // Given
    viewport = installFakeViewport({
      ...standalone,
      innerHeight: 700,
      visualViewport: { height: 700, scale: 1 },
    });
    const { unmount } = renderHook(() => useAppHeight());
    const whileMounted = viewport.subscriptions();
    const timersWhileMounted = vi.getTimerCount();

    // When
    unmount();
    viewport.setInnerHeight(300);
    viewport.fireVisualViewportResize();
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(3000);

    // Then
    expect(whileMounted).toBe(1);
    expect(timersWhileMounted).toBe(0);
    expect(viewport.subscriptions()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(appHeight()).toBe("700px");
  });
});

describe("補償が動かない環境", () => {
  it.each([
    ["ブラウザのタブ", { standalone: false, virtualKeyboard: true }],
    [
      "virtualKeyboardが無い(iOS相当)スタンドアロン",
      { standalone: true, virtualKeyboard: false },
    ],
  ])(
    "%sでは、値を書かず、何も購読せず、既定の高さのままにする",
    (_, options) => {
      // Given
      viewport = installFakeViewport({
        ...options,
        innerHeight: 500,
        visualViewport: { height: 500, scale: 1 },
      });

      // When
      renderHook(() => useAppHeight());
      viewport.fireVisualViewportResize();
      vi.advanceTimersByTime(3000);

      // Then
      expect(appHeight()).toBe("100dvh");
      expect(viewport.subscriptions()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
