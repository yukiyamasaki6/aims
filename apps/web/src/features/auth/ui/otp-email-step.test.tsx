import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { OtpEmailStep } from "./otp-email-step";

const authText = translatorFor("auth");

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックする。
vi.mock("./turnstile", () => ({
  Turnstile: forwardRef(function TurnstileStub() {
    return <div data-testid="turnstile-stub" />;
  }),
}));

type Props = ComponentProps<typeof OtpEmailStep>;

function createForm(overrides: Partial<Props> = {}) {
  return {
    idPrefix: "test",
    title: "タイトル",
    email: "",
    onEmailChange: vi.fn(),
    emailError: undefined,
    submitting: false,
    resendCooldown: 0,
    resendError: undefined,
    error: null,
    hydrated: true,
    onSubmit: vi.fn((e) => e.preventDefault()),
    siteKey: "site-key",
    checkRef: { current: undefined },
    onCheck: vi.fn(),
    waiting: false,
    onFailed: vi.fn(),
    ...overrides,
  } satisfies Props;
}

function renderStep(
  form: Props,
  props: { idPrefix?: string; title?: string } = {},
) {
  return render(
    <OtpEmailStep
      {...form}
      idPrefix={props.idPrefix ?? form.idPrefix}
      title={props.title ?? form.title}
    />,
    { wrapper: IntlTestProvider },
  );
}

describe("OtpEmailStep", () => {
  it("メールアドレスの欄に、nameとautocompleteを付ける", () => {
    // Given
    const form = createForm();

    // When
    renderStep(form);

    // Then
    const input = screen.getByPlaceholderText("you@example.com");
    expect(input).toHaveAttribute("name", "email");
    expect(input).toHaveAttribute("autocomplete", "email");
  });

  describe("画面の違いを受け取る表示", () => {
    it("titleを見出しに描く", () => {
      // Given

      // When
      const form = createForm();
      renderStep(form, { title: authText("signInTitle") });

      // Then
      expect(
        screen.getByRole("heading", { name: authText("signInTitle") }),
      ).toBeInTheDocument();
    });

    it("メールのエラー文の要素のidをidPrefixから作り、入力欄と結びつける", () => {
      // Given

      // When
      const form = createForm({
        emailError: "メールのエラー",
      });
      renderStep(form, { idPrefix: "signin" });

      // Then
      const input = screen.getByPlaceholderText("you@example.com");
      const message = screen.getByText("メールのエラー");
      expect(message).toHaveAttribute("id", "signin-email-error");
      expect(input).toHaveAttribute("aria-describedby", "signin-email-error");
      expect(input).toHaveAttribute("aria-invalid", "true");
    });
  });

  describe("入力と送信", () => {
    it("メール欄に値を表示し、入力でsetEmailを呼ぶ", async () => {
      // Given
      const form = createForm({ email: "a@example.com" });
      renderStep(form);
      const input = screen.getByPlaceholderText("you@example.com");

      // When
      await userEvent.type(input, "b");

      // Then
      expect(input).toHaveValue("a@example.com");
      expect(form.onEmailChange).toHaveBeenCalledWith("a@example.comb");
    });

    it("送信でhandleSendCodeを呼ぶ", () => {
      // Given
      const form = createForm();
      renderStep(form);

      // When
      fireEvent.submit(screen.getByPlaceholderText("you@example.com"));

      // Then
      expect(form.onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe("状態に応じた表示", () => {
    it("メールのエラーがないとき、入力欄を結びつけず有効な状態にする", () => {
      // Given

      // When
      const form = createForm();
      renderStep(form);

      // Then
      const input = screen.getByPlaceholderText("you@example.com");
      expect(input).not.toHaveAttribute("aria-describedby");
      expect(input).toHaveAttribute("aria-invalid", "false");
    });

    it("submittingのとき、送信ボタンをaria-disabledにしスピナーを出す", () => {
      // Given

      // When
      const form = createForm({ submitting: true });
      renderStep(form);

      // Then
      const button = screen.getByRole("button", {
        name: authText("otpSendCode"),
      });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button.querySelector("svg")).not.toBeNull();
    });

    it("primarySubmittingでないとき、送信ボタンは有効でスピナーを出さない", () => {
      // Given

      // When
      const form = createForm({ submitting: false });
      renderStep(form);

      // Then
      const button = screen.getByRole("button", {
        name: authText("otpSendCode"),
      });
      expect(button).toHaveAttribute("aria-disabled", "false");
      expect(button.querySelector("svg")).toBeNull();
    });

    it("hydratedの有無をフォームのdata-hydratedに反映する", () => {
      // Given

      // When
      const ready = createForm({ hydrated: true });
      const notReady = createForm({ hydrated: false });
      const { container, unmount } = renderStep(ready);
      const readyValue = container
        .querySelector("form")
        ?.getAttribute("data-hydrated");
      unmount();
      const second = renderStep(notReady);
      const notReadyValue = second.container
        .querySelector("form")
        ?.getAttribute("data-hydrated");

      // Then
      expect(readyValue).toBe("true");
      expect(notReadyValue).toBe("false");
    });

    it("errorがないとき全体のエラーを描かない", () => {
      // Given

      // When
      const form = createForm({ error: null });
      const { container } = renderStep(form);

      // Then
      expect(container.querySelector("p.text-destructive")).toBeNull();
    });
  });
});

describe("OtpEmailStepの失敗と再送待機の表示", () => {
  it("再送待機の残り秒数を受け取ると、送信ボタンに残り秒数を表示する", () => {
    // Given

    // When
    const form = createForm({ resendCooldown: 42 });
    renderStep(form);

    // Then
    expect(
      screen.getByRole("button", {
        name: authText("otpResendWait", { seconds: "42" }),
      }),
    ).toBeInTheDocument();
  });

  it("再送の失敗の文を受け取ると、フォームの中に表示する", () => {
    // Given

    // When
    const form = createForm({ resendError: "再送の失敗" });
    const { container } = renderStep(form);

    // Then
    expect(container.querySelector("form")).toHaveTextContent("再送の失敗");
  });

  it("フォーム全体の失敗の文を受け取ると、表示する", () => {
    // Given

    // When
    const form = createForm({ error: "全体の失敗" });
    renderStep(form);

    // Then
    expect(screen.getByText("全体の失敗")).toBeInTheDocument();
  });
});
