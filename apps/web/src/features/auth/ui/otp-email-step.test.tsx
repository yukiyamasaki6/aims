import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { EMAIL_MAX_LENGTH } from "../domain/email-address";
import { OtpEmailStep } from "./otp-email-step";

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックし、errorの受け渡しを確かめられるスタブで模す。
vi.mock("@/components/turnstile", () => ({
  Turnstile: forwardRef<unknown, { error?: string }>(
    function TurnstileStub(props) {
      return (
        <>
          <div data-testid="turnstile-stub" />
          {props.error && <p>{props.error}</p>}
        </>
      );
    },
  ),
}));

type Props = ComponentProps<typeof OtpEmailStep>;

function createForm(overrides: Partial<Props> = {}) {
  return {
    idPrefix: "test",
    title: "タイトル",
    footer: <p>フッター</p>,
    email: "",
    onEmailChange: vi.fn(),
    emailError: undefined,
    captchaError: undefined,
    submitting: false,
    error: null,
    hydrated: true,
    onSubmit: vi.fn((e) => e.preventDefault()),
    checkRef: { current: undefined },
    onCheck: vi.fn(),
    checked: false,
    ...overrides,
  } satisfies Props;
}

function renderStep(
  form: Props,
  props: { idPrefix?: string; title?: string; footer?: string } = {},
) {
  return render(
    <OtpEmailStep
      {...form}
      idPrefix={props.idPrefix ?? form.idPrefix}
      title={props.title ?? form.title}
      footer={props.footer ? <p>{props.footer}</p> : form.footer}
    />,
  );
}

describe("OtpEmailStep", () => {
  describe("画面の違いを受け取る表示", () => {
    it("titleを見出しに、footerを全体のエラーの下に描く", () => {
      // Given

      // When
      const form = createForm({ error: "全体のエラー" });
      renderStep(form, { title: "パスワードを再設定", footer: "戻るリンク" });

      // Then
      expect(
        screen.getByRole("heading", { name: "パスワードを再設定" }),
      ).toBeInTheDocument();
      const errorText = screen.getByText("全体のエラー");
      const footer = screen.getByText("戻るリンク");
      expect(
        errorText.compareDocumentPosition(footer) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("メールのエラー文の要素のidをidPrefixから作り、入力欄と結びつける", () => {
      // Given

      // When
      const form = createForm({
        emailError: "メールのエラー",
      });
      renderStep(form, { idPrefix: "reset-password" });

      // Then
      const input = screen.getByPlaceholderText("you@example.com");
      const message = screen.getByText("メールのエラー");
      expect(message).toHaveAttribute("id", "reset-password-email-error");
      expect(input).toHaveAttribute(
        "aria-describedby",
        "reset-password-email-error",
      );
      expect(input).toHaveAttribute("aria-invalid", "true");
    });
  });

  describe("入力欄", () => {
    it("メールアドレスの入力欄の最大長は、ドメインのメールアドレスの上限である", () => {
      // Given

      // When
      renderStep(createForm());

      // Then
      const input = screen.getByPlaceholderText("you@example.com");
      expect(input).toHaveAttribute("maxlength", String(EMAIL_MAX_LENGTH));
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

    it("captchaのエラーをTurnstileへ渡す", () => {
      // Given

      // When
      const form = createForm({
        captchaError: "captchaのエラー",
      });
      renderStep(form);

      // Then
      expect(screen.getByText("captchaのエラー")).toBeInTheDocument();
    });

    it("submittingのとき、送信ボタンをaria-disabledにしスピナーを出す", () => {
      // Given

      // When
      const form = createForm({ submitting: true });
      renderStep(form);

      // Then
      const button = screen.getByRole("button", { name: "認証コードを送信" });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button.querySelector("svg")).not.toBeNull();
    });

    it("primarySubmittingでないとき、送信ボタンは有効でスピナーを出さない", () => {
      // Given

      // When
      const form = createForm({ submitting: false });
      renderStep(form);

      // Then
      const button = screen.getByRole("button", { name: "認証コードを送信" });
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

    it("セキュリティチェックの完了を送信ボタンのdata-captcha-readyに反映する", () => {
      // Given

      // When
      const ready = createForm({ checked: true });
      const notReady = createForm({ checked: false });
      const { unmount } = renderStep(ready);
      const readyValue = screen
        .getByRole("button", { name: "認証コードを送信" })
        .getAttribute("data-captcha-ready");
      unmount();
      renderStep(notReady);
      const notReadyValue = screen
        .getByRole("button", { name: "認証コードを送信" })
        .getAttribute("data-captcha-ready");

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
      expect(screen.getByText("フッター")).toBeInTheDocument();
    });
  });
});
