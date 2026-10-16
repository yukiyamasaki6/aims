import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { OtpEmailStep, type OtpEmailStepModel } from "./email-step";

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックし、errorの受け渡しを確かめられるスタブで模す。
vi.mock("./turnstile", () => ({
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

function createForm(overrides: Partial<OtpEmailStepModel> = {}) {
  return {
    email: "",
    setEmail: vi.fn(),
    emailFieldErrors: {},
    primarySubmitting: false,
    error: null,
    hydrated: true,
    handleSendCode: vi.fn((e) => e.preventDefault()),
    turnstileRef: { current: undefined },
    setCaptchaToken: vi.fn(),
    captchaToken: null,
    ...overrides,
  } satisfies OtpEmailStepModel;
}

function renderStep(
  form: OtpEmailStepModel,
  props: { idPrefix?: string; title?: string; footer?: string } = {},
) {
  return render(
    <OtpEmailStep
      form={form}
      idPrefix={props.idPrefix ?? "test"}
      title={props.title ?? "タイトル"}
      footer={<p>{props.footer ?? "フッター"}</p>}
    />,
  );
}

describe("OtpEmailStep", () => {
  describe("画面の違いを受け取る表示", () => {
    it("titleを見出しに、footerを全体のエラーの下に描く", () => {
      // Given
      const form = createForm({ error: "全体のエラー" });

      // When
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
      const form = createForm({
        emailFieldErrors: { email: "メールのエラー" },
      });

      // When
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
      expect(form.setEmail).toHaveBeenCalledWith("a@example.comb");
    });

    it("送信でhandleSendCodeを呼ぶ", () => {
      // Given
      const form = createForm();
      renderStep(form);

      // When
      fireEvent.submit(screen.getByPlaceholderText("you@example.com"));

      // Then
      expect(form.handleSendCode).toHaveBeenCalledTimes(1);
    });
  });

  describe("状態に応じた表示", () => {
    it("メールのエラーがないとき、入力欄を結びつけず有効な状態にする", () => {
      // Given
      const form = createForm();

      // When
      renderStep(form);

      // Then
      const input = screen.getByPlaceholderText("you@example.com");
      expect(input).not.toHaveAttribute("aria-describedby");
      expect(input).toHaveAttribute("aria-invalid", "false");
    });

    it("captchaのエラーをTurnstileへ渡す", () => {
      // Given
      const form = createForm({
        emailFieldErrors: { captcha: "captchaのエラー" },
      });

      // When
      renderStep(form);

      // Then
      expect(screen.getByText("captchaのエラー")).toBeInTheDocument();
    });

    it("primarySubmittingのとき、送信ボタンをaria-disabledにしスピナーを出す", () => {
      // Given
      const form = createForm({ primarySubmitting: true });

      // When
      renderStep(form);

      // Then
      const button = screen.getByRole("button", { name: "認証コードを送信" });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button.querySelector("svg")).not.toBeNull();
    });

    it("primarySubmittingでないとき、送信ボタンは有効でスピナーを出さない", () => {
      // Given
      const form = createForm({ primarySubmitting: false });

      // When
      renderStep(form);

      // Then
      const button = screen.getByRole("button", { name: "認証コードを送信" });
      expect(button).toHaveAttribute("aria-disabled", "false");
      expect(button.querySelector("svg")).toBeNull();
    });

    it("hydratedとcaptchaTokenの有無をdata属性に反映する", () => {
      // Given
      const ready = createForm({ hydrated: true, captchaToken: "token" });
      const notReady = createForm({ hydrated: false, captchaToken: null });

      // When
      const { container, unmount } = renderStep(ready);
      const readyForm = container.querySelector("form");
      const readyButton = screen.getByRole("button", {
        name: "認証コードを送信",
      });
      const readyAttributes = [
        readyForm?.getAttribute("data-hydrated"),
        readyButton.getAttribute("data-captcha-ready"),
      ];
      unmount();
      const second = renderStep(notReady);
      const notReadyAttributes = [
        second.container.querySelector("form")?.getAttribute("data-hydrated"),
        screen
          .getByRole("button", { name: "認証コードを送信" })
          .getAttribute("data-captcha-ready"),
      ];

      // Then
      expect(readyAttributes).toEqual(["true", "true"]);
      expect(notReadyAttributes).toEqual(["false", "false"]);
    });

    it("errorがないとき全体のエラーを描かない", () => {
      // Given
      const form = createForm({ error: null });

      // When
      const { container } = renderStep(form);

      // Then
      expect(container.querySelector("p.text-destructive")).toBeNull();
      expect(screen.getByText("フッター")).toBeInTheDocument();
    });
  });
});
