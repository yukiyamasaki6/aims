import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

// ウィジェットを包む箱。畳み中はsr-onlyで、操作が必要な間は外れる。
function widgetBox() {
  const box = screen.getByTestId("turnstile").parentElement;
  if (!box) throw new Error("widget box not found");
  return box;
}

function expectCollapsed() {
  expect(widgetBox()).toHaveClass("sr-only");
}

function expectExpanded() {
  expect(widgetBox()).not.toHaveClass("sr-only");
}

describe("Turnstile", () => {
  describe("描画", () => {
    it("渡されたサイトキーと、操作が必要なときだけ表示するオプションでウィジェットを描画する", () => {
      // Given
      // When
      render(<Turnstile siteKey="test-site-key" onVerify={vi.fn()} />);

      // Then
      expect(screen.getByTestId("turnstile")).toBeInTheDocument();
      expect(siteKeyProp.current).toBe("test-site-key");
      expect(optionsProp.current).toEqual({
        size: "normal",
        appearance: "interaction-only",
      });
    });

    it("初期状態では領域を取らないよう畳まれている", () => {
      // Given

      // When
      render(<Turnstile siteKey="test-site-key" onVerify={vi.fn()} />);

      // Then
      expectCollapsed();
    });
  });

  describe("操作が必要になったとき", () => {
    it("操作が必要になる前のコールバックで展開する", () => {
      // Given
      render(<Turnstile siteKey="test-site-key" onVerify={vi.fn()} />);

      // When
      act(() => callbacks.current.onBeforeInteractive?.());

      // Then
      expectExpanded();
    });

    it("操作が終わったコールバックで再び畳まれる", () => {
      // Given
      render(<Turnstile siteKey="test-site-key" onVerify={vi.fn()} />);
      act(() => callbacks.current.onBeforeInteractive?.());

      // When
      act(() => callbacks.current.onAfterInteractive?.());

      // Then
      expectCollapsed();
    });

    it("成功すると畳まれ、トークンでonVerifyを呼ぶ", () => {
      // Given
      const handleVerify = vi.fn();
      render(<Turnstile siteKey="test-site-key" onVerify={handleVerify} />);
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
      render(<Turnstile siteKey="test-site-key" onVerify={handleVerify} />);

      // When
      act(() => callbacks.current.onSuccess?.("token-123"));

      // Then
      expectCollapsed();
      expect(handleVerify).toHaveBeenCalledWith("token-123");
    });

    it("期限切れになると、nullでonVerifyを呼ぶ", () => {
      // Given
      const handleVerify = vi.fn();
      render(<Turnstile siteKey="test-site-key" onVerify={handleVerify} />);

      // When
      act(() => callbacks.current.onExpire?.());

      // Then
      expect(handleVerify).toHaveBeenCalledWith(null);
    });

    it("エラーになると失敗を見せるために展開し、nullでonVerifyを呼ぶ", () => {
      // Given
      const handleVerify = vi.fn();
      render(<Turnstile siteKey="test-site-key" onVerify={handleVerify} />);

      // When
      act(() => callbacks.current.onError?.());

      // Then
      expectExpanded();
      expect(handleVerify).toHaveBeenCalledWith(null);
    });

    it("エラーで展開したあと、自動リトライが成功すると畳まれる", () => {
      // Given
      render(<Turnstile siteKey="test-site-key" onVerify={vi.fn()} />);
      act(() => callbacks.current.onError?.());

      // When
      act(() => callbacks.current.onSuccess?.("token-retry"));

      // Then
      expectCollapsed();
    });
  });

  describe("error prop", () => {
    it("errorが無い場合は文言を描画しない", () => {
      // Given
      // When
      render(<Turnstile siteKey="test-site-key" onVerify={vi.fn()} />);

      // Then
      expect(document.querySelector("p")).toBeNull();
    });

    it("操作が必要でないときも、errorの文言を表示する", () => {
      // Given

      // When
      const turnstile = (
        <Turnstile
          siteKey="test-site-key"
          onVerify={vi.fn()}
          error="未完了です"
        />
      );
      render(turnstile);

      // Then
      expect(screen.getByText("未完了です")).toBeInTheDocument();
    });

    it("操作が必要な間も、errorの文言を表示する", () => {
      // Given
      render(
        <Turnstile
          siteKey="test-site-key"
          onVerify={vi.fn()}
          error="未完了です"
        />,
      );

      // When
      act(() => callbacks.current.onBeforeInteractive?.());

      // Then
      expect(screen.getByText("未完了です")).toBeInTheDocument();
    });
  });
});
