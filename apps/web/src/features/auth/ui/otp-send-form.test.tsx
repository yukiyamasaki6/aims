import { fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { OtpSendForm } from "./otp-send-form";

const authText = translatorFor("auth");

const widget = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
  onFailed: undefined as (() => void) | undefined,
  waiting: undefined as boolean | undefined,
}));

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックする。
vi.mock("./turnstile", () => ({
  Turnstile: forwardRef<
    unknown,
    {
      onVerify: (token: string | null) => void;
      onFailed: () => void;
      waiting: boolean;
    }
  >(function TurnstileStub({ onVerify, onFailed, waiting }) {
    widget.onVerify = onVerify;
    widget.onFailed = onFailed;
    widget.waiting = waiting;
    return <div data-testid="turnstile-stub" />;
  }),
}));

type Props = ComponentProps<typeof OtpSendForm>;

function createForm(overrides: Partial<Props> = {}) {
  return {
    onSubmit: vi.fn((e) => e.preventDefault()),
    hydrated: true,
    siteKey: "site-key",
    checkRef: { current: undefined },
    onCheck: vi.fn(),
    onFailed: vi.fn(),
    waiting: false,
    submitting: false,
    label: "送信の文言",
    variant: "default",
    resendCooldown: 0,
    resendError: undefined,
    error: null,
    ...overrides,
  } satisfies Props;
}

function renderForm(form: Props) {
  return render(<OtpSendForm {...form} />, { wrapper: IntlTestProvider });
}

describe("OtpSendForm", () => {
  describe("送信ボタン", () => {
    it("再送待機が0と1秒の境界で、0は渡された文言、1秒は残り秒数つきの再送の文言を描く", () => {
      // Given

      // When
      const { unmount } = renderForm(createForm({ resendCooldown: 0 }));
      const zero = screen.getByRole("button").textContent;
      unmount();
      renderForm(createForm({ resendCooldown: 1 }));
      const one = screen.getByRole("button").textContent;

      // Then
      expect(zero).toBe("送信の文言");
      expect(one).toBe(authText("otpResendWait", { seconds: "1" }));
    });

    it("再送待機中も、送信ボタンを押せる状態で描く", () => {
      // Given

      // When
      renderForm(createForm({ resendCooldown: 30 }));

      // Then
      expect(screen.getByRole("button")).toHaveAttribute(
        "aria-disabled",
        "false",
      );
    });

    it("送信の処理中は、送信ボタンをaria-disabledにしスピナーを出す", () => {
      // Given

      // When
      renderForm(createForm({ submitting: true }));

      // Then
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button.querySelector("svg")).not.toBeNull();
    });

    it("送信でonSubmitを呼ぶ", () => {
      // Given
      const form = createForm();
      const { container } = renderForm(form);

      // When
      fireEvent.submit(container.querySelector("form") as HTMLFormElement);

      // Then
      expect(form.onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe("失敗の表示", () => {
    it("再送待機の失敗の文を、フォームの中の送信ボタンの後に描く", () => {
      // Given

      // When
      const { container } = renderForm(
        createForm({ resendError: "再送の失敗" }),
      );

      // Then
      const message = screen.getByText("再送の失敗");
      expect(container.querySelector("form")).toContainElement(message);
      expect(
        screen.getByRole("button").compareDocumentPosition(message) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("画面の失敗の文を、フォームの外に描く", () => {
      // Given

      // When
      const { container } = renderForm(createForm({ error: "全体の失敗" }));

      // Then
      const message = screen.getByText("全体の失敗");
      expect(message).toBeInTheDocument();
      expect(container.querySelector("form")).not.toContainElement(message);
    });

    it("失敗が無いとき、失敗の文を描かない", () => {
      // Given

      // When
      const { container } = renderForm(createForm());

      // Then
      expect(container.querySelectorAll("p")).toHaveLength(0);
    });
  });

  describe("入力欄とチェック", () => {
    it("子の入力欄を、フォームの中の送信ボタンの前に描く", () => {
      // Given

      // When
      const { container } = renderForm(
        createForm({ children: <input aria-label="子の入力欄" /> }),
      );

      // Then
      const input = screen.getByLabelText("子の入力欄");
      expect(container.querySelector("form")).toContainElement(input);
      expect(
        input.compareDocumentPosition(screen.getByRole("button")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("hydratedの有無をフォームのdata-hydratedに反映する", () => {
      // Given

      // When
      const { container, unmount } = renderForm(createForm({ hydrated: true }));
      const hydrated = container
        .querySelector("form")
        ?.getAttribute("data-hydrated");
      unmount();
      const second = renderForm(createForm({ hydrated: false }));
      const notHydrated = second.container
        .querySelector("form")
        ?.getAttribute("data-hydrated");

      // Then
      expect(hydrated).toBe("true");
      expect(notHydrated).toBe("false");
    });

    it("チェックの部品へ、待ちの状態と完了・失敗の通知先を渡す", () => {
      // Given
      const form = createForm({ waiting: true });
      renderForm(form);

      // When
      widget.onVerify?.("check");
      widget.onFailed?.();

      // Then
      expect(widget.waiting).toBe(true);
      expect(form.onCheck).toHaveBeenCalledExactlyOnceWith("check");
      expect(form.onFailed).toHaveBeenCalledTimes(1);
    });
  });
});
