import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FakeViewport,
  installFakeViewport,
} from "@/lib/viewport/fake-viewport-test-helpers";
import { ViewportBadge } from "./viewport-badge";

let viewport: FakeViewport;

beforeEach(() => {
  vi.useFakeTimers();
  viewport = installFakeViewport({
    visualViewport: { height: 640, scale: 1.5 },
  });
});

afterEach(() => {
  viewport.restore();
  vi.useRealTimers();
});

function badges() {
  return document.querySelectorAll(
    '[data-testid="viewport-diagnostics-badge"]',
  );
}

describe("ViewportBadge", () => {
  it("描画すると、document.body直下にバッジが1つ追加される", () => {
    // Given
    // When
    render(<ViewportBadge />);

    // Then
    expect(badges()).toHaveLength(1);
    expect(badges()[0].parentElement).toBe(document.body);
  });

  it("visualViewportの高さに倍率を掛けた値をvvとして表示する", () => {
    // Given
    // When
    render(<ViewportBadge />);

    // Then
    expect(badges()[0].textContent).toContain("vv 960");
  });

  it("測定値の識別子(inner、vv、dvh、--app-height)を含む", () => {
    // Given
    // When
    render(<ViewportBadge />);

    // Then
    const text = badges()[0].textContent;
    for (const identifier of ["inner", "vv", "dvh", "--app-height"]) {
      expect(text).toContain(identifier);
    }
  });

  it("アンマウントすると、バッジの要素が除かれ、購読とタイマーが0になる", () => {
    // Given
    const { unmount } = render(<ViewportBadge />);
    expect(viewport.subscriptions()).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // When
    unmount();

    // Then
    expect(badges()).toHaveLength(0);
    expect(viewport.subscriptions()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("visualViewportが無いとき、vvはinnerHeight、vvTopは-を表示する", () => {
    // Given
    viewport.restore();
    viewport = installFakeViewport({ visualViewport: null, innerHeight: 700 });

    // When
    render(<ViewportBadge />);

    // Then
    expect(badges()[0].textContent).toContain("vv 700 vvTop -");
  });

  it("測定値が許容を超えてずれているとき、先頭にBADを表示する", () => {
    // Given
    // jsdomではdvhとbodyの高さが0のため、可視の高さ(960)とのずれが許容を超える。
    // When
    render(<ViewportBadge />);

    // Then
    expect(badges()[0].textContent).toMatch(/^BAD /);
  });

  it("測定値が許容に収まっているとき、先頭にokを表示する", () => {
    // Given
    viewport.restore();
    viewport = installFakeViewport({ visualViewport: null, innerHeight: 0 });

    // When
    render(<ViewportBadge />);

    // Then
    expect(badges()[0].textContent).toMatch(/^ok /);
  });
});
