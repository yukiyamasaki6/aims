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

  it("開くと、visualViewportの高さに拡大率を掛けた値をpxで書く", () => {
    // Given
    // 拡大率が1以外の値で、掛け算を確かめる。
    viewport = installFakeViewport({
      ...standalone,
      visualViewport: { height: 300, scale: 2 },
    });

    // When
    renderHook(() => useAppHeight());

    // Then
    expect(appHeight()).toBe("600px");
  });

  it("visualViewportが無ければ、innerHeightをpxで書く", () => {
    // Given
    viewport = installFakeViewport({
      ...standalone,
      visualViewport: null,
      innerHeight: 640,
    });

    // When
    renderHook(() => useAppHeight());

    // Then
    expect(appHeight()).toBe("640px");
  });

  it("visualViewportのresizeで更新する", () => {
    // Given
    viewport = installFakeViewport({
      ...standalone,
      visualViewport: { height: 700, scale: 1 },
    });
    renderHook(() => useAppHeight());

    // When
    act(() => {
      viewport.setVisualViewportHeight(400);
      viewport.fireVisualViewportResize();
    });

    // Then
    expect(appHeight()).toBe("400px");
  });

  it.each([
    ["windowのresize", window, "resize"],
    ["windowのpageshow", window, "pageshow"],
    ["documentのvisibilitychange", document, "visibilitychange"],
    ["windowのorientationchange", window, "orientationchange"],
  ] as const)("%sで、値が変わっていれば更新する", (_, target, type) => {
    // Given
    viewport = installFakeViewport({
      ...standalone,
      visualViewport: { height: 700, scale: 1 },
    });
    renderHook(() => useAppHeight());

    // When
    act(() => {
      viewport.setVisualViewportHeight(450);
      target.dispatchEvent(new Event(type));
    });

    // Then
    expect(appHeight()).toBe("450px");
  });

  it("通知なしに変わった値を、0.5秒後と2秒後の再確認で反映する", () => {
    // Given
    viewport = installFakeViewport({
      ...standalone,
      visualViewport: { height: 700, scale: 1 },
    });
    renderHook(() => useAppHeight());

    // When
    viewport.setVisualViewportHeight(650);
    act(() => {
      vi.advanceTimersByTime(499);
    });
    const beforeFirst = appHeight();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const afterFirst = appHeight();
    viewport.setVisualViewportHeight(600);
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // Then
    expect([beforeFirst, afterFirst, appHeight()]).toEqual([
      "700px",
      "650px",
      "600px",
    ]);
  });

  it("直前に書いた値との差が0.5px未満なら書かず、0.5px以上なら書く。小数の高さで境界を確かめる", () => {
    // Given
    // 実機の高さは小数になり得るため、0.5pxの境界を小数で確かめる。
    viewport = installFakeViewport({
      ...standalone,
      visualViewport: { height: 600, scale: 1 },
    });
    renderHook(() => useAppHeight());
    const change = (height: number) => {
      act(() => {
        viewport.setVisualViewportHeight(height);
        viewport.fireVisualViewportResize();
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

  it("アンマウントで全ての購読と時限を外し、以後は書かない", () => {
    // Given
    viewport = installFakeViewport({
      ...standalone,
      visualViewport: { height: 700, scale: 1 },
    });
    const { unmount } = renderHook(() => useAppHeight());
    const whileMounted = viewport.subscriptions();

    // When
    unmount();
    viewport.setVisualViewportHeight(300);
    viewport.fireVisualViewportResize();
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(3000);

    // Then
    expect(whileMounted).toBeGreaterThan(0);
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
