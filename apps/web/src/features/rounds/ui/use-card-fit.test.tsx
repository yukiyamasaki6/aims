import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCardFit } from "./use-card-fit";

const texts = { format: "屋外", bow: "リカーブ" };
const fonts = { date: { fontSize: "14px" }, tag: { fontSize: "11px" } };

const renders = { count: 0 };

// CardRowと同じく、描画のたびに新しいフォントの指定の対象を渡す。
function Probe({ label = texts }: { label?: typeof texts }) {
  renders.count += 1;
  const { ref, metrics } = useCardFit(label, {
    date: { ...fonts.date },
    tag: { ...fonts.tag },
  });
  return (
    <a
      ref={ref}
      href="/x"
      data-testid="probe"
      style={{ paddingLeft: "12px", paddingRight: "12px" }}
    >
      {metrics === null ? "none" : JSON.stringify(metrics)}
    </a>
  );
}

const shown = () => screen.getByTestId("probe").textContent;

// jsdomにはレイアウトがないため、幅の取得をテストが差し替える。
function stubLayout(clientWidth: number, textWidth: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
    clientWidth,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: textWidth,
  } as DOMRect);
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
}

afterEach(() => {
  Reflect.deleteProperty(document, "fonts");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeResizeObserver.instances = [];
});

describe("useCardFit", () => {
  it("要素の幅から左右の余白を引いた幅と、切り上げて1px足した文字の幅を返す", () => {
    // Given
    stubLayout(300, 40.2);

    // When
    render(<Probe />);

    // Then
    expect(JSON.parse(shown() ?? "")).toEqual({
      available: 276,
      date: 42,
      nameMin: 42,
      format: 42,
      bow: 42,
    });
  });

  it("レイアウトがなく幅が0のときは、測定値をnullにする", () => {
    // Given
    stubLayout(0, 40);

    // When
    render(<Probe />);

    // Then
    expect(shown()).toBe("none");
  });

  it("幅の変化を受けて測り直し、取り外すと監視をやめる", () => {
    // Given
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    stubLayout(300, 40);
    const { unmount } = render(<Probe />);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);

    // When
    act(() => FakeResizeObserver.instances[0]?.callback());

    // Then
    expect(JSON.parse(shown() ?? "").available).toBe(176);
    unmount();
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
  });

  it("フォントの読み込みが終わった後に測り直す", async () => {
    // Given
    const fonts = Promise.withResolvers<void>();
    // jsdomにはdocument.fontsがない。
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: fonts.promise },
    });
    stubLayout(300, 40);
    render(<Probe />);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 60,
    } as DOMRect);

    // When
    await act(async () => {
      fonts.resolve();
      await fonts.promise;
    });

    // Then
    expect(JSON.parse(shown() ?? "").date).toBe(61);
  });

  it("測定値が変わらないときは、再測定しても再描画しない", () => {
    // Given
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    stubLayout(300, 40);
    renders.count = 0;
    render(<Probe />);
    const before = renders.count;

    // When
    act(() => FakeResizeObserver.instances[0]?.callback());

    // Then
    expect(renders.count).toBe(before);
  });

  it("再描画しても、監視の付け直し・測定・フォントの待ちの登録をやり直さない", () => {
    // Given
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const ready = Promise.resolve();
    const readyAccess = vi.fn(() => ready);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      get: () => ({
        get ready() {
          return readyAccess();
        },
      }),
    });
    stubLayout(300, 40);
    const { rerender } = render(<Probe />);
    const measuredCalls = vi.mocked(HTMLElement.prototype.getBoundingClientRect)
      .mock.calls.length;

    // When
    rerender(<Probe />);
    rerender(<Probe />);

    // Then
    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(readyAccess).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mock.calls,
    ).toHaveLength(measuredCalls);
  });

  it("アンマウントの後にフォントの読み込みが終わっても、測り直さない", async () => {
    // Given
    const fonts = Promise.withResolvers<void>();
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: fonts.promise },
    });
    stubLayout(300, 40);
    const { unmount } = render(<Probe />);
    unmount();
    const rect = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    const before = rect.mock.calls.length;

    // When
    await act(async () => {
      fonts.resolve();
      await fonts.promise;
    });

    // Then
    expect(rect.mock.calls).toHaveLength(before);
  });

  it("種別か弓種の表示名が変わったときは、測り直す", () => {
    // Given
    stubLayout(300, 40);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return {
          width: this.textContent === "コンパウンド" ? 90 : 40,
        } as DOMRect;
      },
    );
    const { rerender } = render(<Probe />);
    const before = JSON.parse(shown() ?? "").bow;

    // When
    rerender(<Probe label={{ format: "屋外", bow: "コンパウンド" }} />);

    // Then
    expect(before).toBe(41);
    expect(JSON.parse(shown() ?? "").bow).toBe(91);
  });
});
