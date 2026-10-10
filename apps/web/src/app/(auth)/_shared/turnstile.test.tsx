import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Turnstile } from "./turnstile";

type Callbacks = {
  onSuccess?: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  onBeforeInteractive?: () => void;
  onAfterInteractive?: () => void;
};

const { callbacks, siteKeyProp, optionsProp } = vi.hoisted(() => ({
  callbacks: { current: {} as Callbacks },
  siteKeyProp: { current: undefined as string | undefined },
  optionsProp: {
    current: undefined as { size?: string; appearance?: string } | undefined,
  },
}));

vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: (
    props: Callbacks & {
      siteKey: string;
      options?: { size?: string; appearance?: string };
    },
  ) => {
    siteKeyProp.current = props.siteKey;
    optionsProp.current = props.options;
    callbacks.current = props;
    return <div data-testid="turnstile" />;
  },
}));

// ウィジェットを包む箱。畳み中はsr-only、操作が必要な間は300x65の領域になる。
function widgetBox() {
  const box = screen.getByTestId("turnstile").parentElement;
  if (!box) throw new Error("widget box not found");
  return box;
}

function expectCollapsed() {
  expect(widgetBox()).toHaveClass("sr-only");
  expect(widgetBox()).not.toHaveClass("h-[65px]");
}

function expectExpanded() {
  expect(widgetBox()).toHaveClass("h-[65px]", "w-[300px]");
  expect(widgetBox()).not.toHaveClass("sr-only");
}

describe("Turnstile", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("描画", () => {
    it("設定されたサイトキーと、操作が必要なときだけ表示するオプションでウィジェットを描画する", () => {
      // When
      render(<Turnstile onVerify={vi.fn()} />);

      // Then
      expect(screen.getByTestId("turnstile")).toBeInTheDocument();
      expect(siteKeyProp.current).toBe("test-site-key");
      expect(optionsProp.current).toEqual({
        size: "normal",
        appearance: "interaction-only",
      });
    });

    it("初期状態では領域を取らないよう畳まれている(hiddenやdisplay:noneにはしない)", () => {
      // When
      render(<Turnstile onVerify={vi.fn()} />);

      // Then
      expectCollapsed();
      expect(widgetBox()).not.toHaveClass("hidden");
    });

    it("サイトキーの環境変数が無い場合は例外を投げる", () => {
      // Given
      vi.unstubAllEnvs();

      // When / Then
      expect(() => render(<Turnstile onVerify={vi.fn()} />)).toThrow(
        "Missing NEXT_PUBLIC_TURNSTILE_SITE_KEY environment variable.",
      );
    });
  });

  describe("操作が必要になったとき", () => {
    it("操作が必要になる前のコールバックで300x65の領域に展開する", () => {
      // Given
      render(<Turnstile onVerify={vi.fn()} />);

      // When
      act(() => callbacks.current.onBeforeInteractive?.());

      // Then
      expectExpanded();
    });

    it("操作が終わったコールバックで再び畳まれる", () => {
      // Given
      render(<Turnstile onVerify={vi.fn()} />);
      act(() => callbacks.current.onBeforeInteractive?.());

      // When
      act(() => callbacks.current.onAfterInteractive?.());

      // Then
      expectCollapsed();
    });

    it("成功すると畳まれ、トークンでonVerifyを呼ぶ", () => {
      // Given
      const handleVerify = vi.fn();
      render(<Turnstile onVerify={handleVerify} />);
      act(() => callbacks.current.onBeforeInteractive?.());

      // When
      act(() => callbacks.current.onSuccess?.("token-123"));

      // Then
      expectCollapsed();
      expect(handleVerify).toHaveBeenCalledWith("token-123");
    });

    it("通常のチャレンジで成功しても、トークンでonVerifyを呼び、畳まれたままである", () => {
      // Given
      const handleVerify = vi.fn();
      render(<Turnstile onVerify={handleVerify} />);

      // When
      act(() => callbacks.current.onSuccess?.("token-123"));

      // Then
      expectCollapsed();
      expect(handleVerify).toHaveBeenCalledWith("token-123");
    });

    it("期限切れになると畳まれ、nullでonVerifyを呼ぶ", () => {
      // Given
      const handleVerify = vi.fn();
      render(<Turnstile onVerify={handleVerify} />);
      act(() => callbacks.current.onBeforeInteractive?.());

      // When
      act(() => callbacks.current.onExpire?.());

      // Then
      expectCollapsed();
      expect(handleVerify).toHaveBeenCalledWith(null);
    });

    it("エラーになると失敗を見せるために展開し、nullでonVerifyを呼ぶ", () => {
      // Given
      const handleVerify = vi.fn();
      render(<Turnstile onVerify={handleVerify} />);

      // When
      act(() => callbacks.current.onError?.());

      // Then
      expectExpanded();
      expect(handleVerify).toHaveBeenCalledWith(null);
    });

    it("エラーで展開したあと、自動リトライが成功すると畳まれる", () => {
      // Given
      render(<Turnstile onVerify={vi.fn()} />);
      act(() => callbacks.current.onError?.());

      // When
      act(() => callbacks.current.onSuccess?.("token-retry"));

      // Then
      expectCollapsed();
    });
  });

  describe("error prop", () => {
    it("errorが無い場合は文言を描画しない", () => {
      // When
      render(<Turnstile onVerify={vi.fn()} />);

      // Then
      expect(document.querySelector("p")).toBeNull();
    });

    it("畳まれていても文言を表示し、リングは付けない", () => {
      // When
      render(<Turnstile onVerify={vi.fn()} error="未完了です" />);

      // Then
      expect(screen.getByText("未完了です")).toBeInTheDocument();
      expectCollapsed();
      expect(widgetBox().className).not.toContain("ring-3");
    });

    it("展開中は文言を表示し、箱にエラーのリングを付ける", () => {
      // Given
      render(<Turnstile onVerify={vi.fn()} error="未完了です" />);

      // When
      act(() => callbacks.current.onBeforeInteractive?.());

      // Then
      expect(screen.getByText("未完了です")).toBeInTheDocument();
      expect(widgetBox()).toHaveClass("ring-3", "ring-destructive/50");
    });

    it("展開中でもerrorが無ければリングを付けない", () => {
      // Given
      render(<Turnstile onVerify={vi.fn()} />);

      // When
      act(() => callbacks.current.onBeforeInteractive?.());

      // Then
      expectExpanded();
      expect(widgetBox().className).not.toContain("ring-3");
    });
  });
});
