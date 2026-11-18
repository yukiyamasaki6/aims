import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { act, render, screen } from "@testing-library/react";
import { createRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_WAIT_LIMIT_MS } from "../domain/captcha-token";
import { Turnstile } from "./turnstile";

type Callbacks = {
  onSuccess?: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  onUnsupported?: () => void;
  onBeforeInteractive?: () => void;
  onAfterInteractive?: () => void;
};

const { callbacks, widgetReset, siteKeyProp, optionsProp } = vi.hoisted(() => ({
  callbacks: { current: {} as Callbacks },
  widgetReset: vi.fn(),
  siteKeyProp: { current: undefined as string | undefined },
  optionsProp: {
    current: undefined as { size?: string; appearance?: string } | undefined,
  },
}));

vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: (
    props: Callbacks & {
      siteKey: string;
      ref?: unknown;
      options?: { size?: string; appearance?: string };
    },
  ) => {
    siteKeyProp.current = props.siteKey;
    // ライブラリのウィジェットの代役。Turnstile部品が包んで画面へ渡す。
    useImperativeHandle(props.ref as React.Ref<unknown>, () => ({
      reset: widgetReset,
    }));
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

const baseProps = {
  siteKey: "test-site-key",
  onVerify: () => {},
  waiting: false,
};

// 画面から渡す参照付きの描画。取り直しの指示は、この参照のresetで行う。
function renderWidget(onVerify: (token: string | null) => void = () => {}) {
  const ref = createRef<TurnstileInstance | undefined>();
  render(<Turnstile {...baseProps} ref={ref} onVerify={onVerify} />);
  return { reset: () => act(() => ref.current?.reset()) };
}

describe("Turnstile", () => {
  describe("描画", () => {
    it("渡されたサイトキーと、操作が必要なときだけ表示するオプションでウィジェットを描画する", () => {
      // Given
      // When
      render(<Turnstile {...baseProps} onVerify={vi.fn()} />);

      // Then
      expect(screen.getByTestId("turnstile")).toBeInTheDocument();
      expect(siteKeyProp.current).toBe("test-site-key");
      expect(optionsProp.current).toEqual({
        size: "normal",
        appearance: "interaction-only",
      });
    });

    it("渡した参照のresetは、ウィジェットのresetを呼ぶ", () => {
      // Given
      widgetReset.mockClear();
      const { reset } = renderWidget();

      // When
      reset();

      // Then
      expect(widgetReset).toHaveBeenCalledOnce();
    });

    it("初期状態では領域を取らないよう畳まれている", () => {
      // Given

      // When
      render(<Turnstile {...baseProps} onVerify={vi.fn()} />);

      // Then
      expectCollapsed();
    });
  });

  describe("操作が必要になったとき", () => {
    it("操作が必要になる前のコールバックで展開する", () => {
      // Given
      render(<Turnstile {...baseProps} />);

      // When
      act(() => callbacks.current.onBeforeInteractive?.());

      // Then
      expectExpanded();
    });

    it("期限切れになると、nullでonVerifyを呼ぶ", () => {
      // Given
      const handleVerify = vi.fn();
      render(<Turnstile {...baseProps} onVerify={handleVerify} />);

      // When
      act(() => callbacks.current.onExpire?.());

      // Then
      expect(handleVerify).toHaveBeenCalledWith(null);
    });

    it("通常のチャレンジで成功しても、トークンでonVerifyを呼び、畳まれたままである", () => {
      // Given
      const handleVerify = vi.fn();
      render(<Turnstile {...baseProps} onVerify={handleVerify} />);

      // When
      act(() => callbacks.current.onSuccess?.("token-123"));

      // Then
      expectCollapsed();
      expect(handleVerify).toHaveBeenCalledWith("token-123");
    });

    it("エラーになると失敗を見せるために展開し、nullでonVerifyを呼ぶ", () => {
      // Given
      const handleVerify = vi.fn();
      render(<Turnstile {...baseProps} onVerify={handleVerify} />);

      // When
      act(() => callbacks.current.onError?.());

      // Then
      expectExpanded();
      expect(handleVerify).toHaveBeenCalledWith(null);
    });
  });

  describe("展開と畳み", () => {
    it("追加チェックが終わっても、展開が続き、参照を通したresetで畳まれる", () => {
      // Given
      const { reset } = renderWidget();
      act(() => callbacks.current.onBeforeInteractive?.());

      // When
      act(() => callbacks.current.onAfterInteractive?.());
      const afterEnd = widgetBox().className;
      reset();

      // Then
      expect(afterEnd).not.toContain("sr-only");
      expectCollapsed();
    });

    it("追加チェックの後の成功は、トークンでonVerifyを呼び、畳まずに展開が続く", () => {
      // Given
      const handleVerify = vi.fn();
      renderWidget(handleVerify);
      act(() => callbacks.current.onBeforeInteractive?.());

      // When
      act(() => callbacks.current.onSuccess?.("token-123"));

      // Then
      expectExpanded();
      expect(handleVerify).toHaveBeenCalledWith("token-123");
    });

    it("エラーで展開したあと、自動リトライが成功しても展開が続き、resetで畳まれる", () => {
      // Given
      const { reset } = renderWidget();
      act(() => callbacks.current.onError?.());

      // When
      act(() => callbacks.current.onSuccess?.("token-retry"));
      const afterSuccess = widgetBox().className;
      reset();

      // Then
      expect(afterSuccess).not.toContain("sr-only");
      expectCollapsed();
    });

    it("未対応でも、展開する", () => {
      // Given
      renderWidget();

      // When
      act(() => callbacks.current.onUnsupported?.());

      // Then
      expectExpanded();
    });

    it("resetで畳んだ後に追加チェックが出れば、再び展開する", () => {
      // Given
      const { reset } = renderWidget();
      act(() => callbacks.current.onBeforeInteractive?.());
      reset();

      // When
      act(() => callbacks.current.onBeforeInteractive?.());

      // Then
      expectExpanded();
    });
  });

  describe("チェックの事実の通知", () => {
    it.each([
      ["エラー", "onError"],
      ["未対応", "onUnsupported"],
    ] as const)("%sで、onFailedを1回呼ぶ", (_name, callback) => {
      // Given
      const handleFailed = vi.fn();
      render(
        <Turnstile {...baseProps} onVerify={vi.fn()} onFailed={handleFailed} />,
      );

      // When
      act(() => callbacks.current[callback]?.());

      // Then
      expect(handleFailed).toHaveBeenCalledOnce();
    });

    it("トークンの到着と失効、追加チェックの表示では、onFailedを呼ばない", () => {
      // Given
      const handleFailed = vi.fn();
      render(
        <Turnstile {...baseProps} onVerify={vi.fn()} onFailed={handleFailed} />,
      );

      // When
      act(() => callbacks.current.onBeforeInteractive?.());
      act(() => callbacks.current.onSuccess?.("token-123"));
      act(() => callbacks.current.onExpire?.());

      // Then
      expect(handleFailed).not.toHaveBeenCalled();
    });
  });

  describe("待ちの上限", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("待ちの間、追加チェックを表示していなければ、上限の直前は呼ばず、直後に1回、onFailedを呼ぶ", () => {
      // Given
      const handleFailed = vi.fn();

      // When
      render(<Turnstile {...baseProps} waiting onFailed={handleFailed} />);
      act(() => vi.advanceTimersByTime(CHECK_WAIT_LIMIT_MS - 1));
      const before = handleFailed.mock.calls.length;
      act(() => vi.advanceTimersByTime(1));
      act(() => vi.advanceTimersByTime(CHECK_WAIT_LIMIT_MS));

      // Then
      expect(before).toBe(0);
      expect(handleFailed).toHaveBeenCalledOnce();
    });

    it("上限の時間切れでは、onFailedを呼ぶが、展開しない", () => {
      // Given
      render(<Turnstile {...baseProps} waiting onFailed={vi.fn()} />);

      // When
      act(() => vi.advanceTimersByTime(CHECK_WAIT_LIMIT_MS));

      // Then
      expectCollapsed();
    });

    it("待ちでなければ、数えない", () => {
      // Given
      const handleFailed = vi.fn();
      render(<Turnstile {...baseProps} onFailed={handleFailed} />);

      // When
      act(() => vi.advanceTimersByTime(CHECK_WAIT_LIMIT_MS * 2));

      // Then
      expect(handleFailed).not.toHaveBeenCalled();
    });

    it("追加チェックの表示中にresetされると、上限の停止が解け、改めて上限を数える", () => {
      // Given
      const handleFailed = vi.fn();
      const ref = createRef<TurnstileInstance | undefined>();
      render(
        <Turnstile {...baseProps} ref={ref} waiting onFailed={handleFailed} />,
      );
      act(() => callbacks.current.onBeforeInteractive?.());
      act(() => vi.advanceTimersByTime(CHECK_WAIT_LIMIT_MS * 2));
      const whileShown = handleFailed.mock.calls.length;

      // When
      act(() => ref.current?.reset());
      act(() => vi.advanceTimersByTime(CHECK_WAIT_LIMIT_MS - 1));
      const beforeLimit = handleFailed.mock.calls.length;
      act(() => vi.advanceTimersByTime(1));

      // Then
      expect(whileShown).toBe(0);
      expect(beforeLimit).toBe(0);
      expect(handleFailed).toHaveBeenCalledOnce();
    });

    it("追加チェックを表示している間は数えず、表示が終わった時点から数え直す", () => {
      // Given
      const handleFailed = vi.fn();
      render(<Turnstile {...baseProps} waiting onFailed={handleFailed} />);
      act(() => callbacks.current.onBeforeInteractive?.());

      // When
      act(() => vi.advanceTimersByTime(CHECK_WAIT_LIMIT_MS * 2));
      const whileShown = handleFailed.mock.calls.length;
      act(() => callbacks.current.onAfterInteractive?.());
      act(() => vi.advanceTimersByTime(CHECK_WAIT_LIMIT_MS - 1));
      const beforeLimit = handleFailed.mock.calls.length;
      act(() => vi.advanceTimersByTime(1));

      // Then
      expect(whileShown).toBe(0);
      expect(beforeLimit).toBe(0);
      expect(handleFailed).toHaveBeenCalledOnce();
    });

    it("トークンの到着(waitingが偽)で、数えるのをやめる", () => {
      // Given
      const handleFailed = vi.fn();
      const { rerender } = render(
        <Turnstile {...baseProps} waiting onFailed={handleFailed} />,
      );

      // When
      rerender(<Turnstile {...baseProps} onFailed={handleFailed} />);
      act(() => vi.advanceTimersByTime(CHECK_WAIT_LIMIT_MS * 2));

      // Then
      expect(handleFailed).not.toHaveBeenCalled();
    });

    it("画面を離れると、上限が過ぎても呼ばない", () => {
      // Given
      const handleFailed = vi.fn();
      const { unmount } = render(
        <Turnstile {...baseProps} waiting onFailed={handleFailed} />,
      );

      // When
      unmount();
      act(() => vi.advanceTimersByTime(CHECK_WAIT_LIMIT_MS * 2));

      // Then
      expect(handleFailed).not.toHaveBeenCalled();
    });
  });
});
