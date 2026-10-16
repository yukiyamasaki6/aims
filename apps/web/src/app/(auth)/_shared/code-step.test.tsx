import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { OtpCodeStep, type OtpCodeStepModel } from "./code-step";

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックする。
vi.mock("./turnstile", () => ({
  Turnstile: forwardRef(function TurnstileStub() {
    return <div data-testid="turnstile-stub" />;
  }),
}));

function createForm(overrides: Partial<OtpCodeStepModel> = {}) {
  return {
    email: "user@example.com",
    code: "",
    setCode: vi.fn(),
    codeFieldErrors: {},
    codeStepPending: null,
    error: null,
    handleBack: vi.fn(),
    handleVerifyCode: vi.fn((e) => e.preventDefault()),
    handleResend: vi.fn(),
    turnstileRef: { current: undefined },
    setCaptchaToken: vi.fn(),
    captchaToken: null,
    resendCooldown: 0,
    ...overrides,
  } satisfies OtpCodeStepModel;
}

function renderStep(form: OtpCodeStepModel, idPrefix = "test") {
  return render(<OtpCodeStep form={form} idPrefix={idPrefix} />);
}

describe("OtpCodeStep", () => {
  describe("表示", () => {
    it("見出しと、メールアドレスを含む説明と迷惑メールの案内を描く", () => {
      // Given
      const form = createForm({ email: "me@example.com" });

      // When
      renderStep(form);

      // Then
      expect(
        screen.getByRole("heading", { name: "認証コードを入力" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "me@example.com に送信されたコードを入力してください。",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "メールが届かない場合は、迷惑メールフォルダをご確認ください。",
        ),
      ).toBeInTheDocument();
    });

    it("codeの値を表示し、入力でsetCodeを呼ぶ", async () => {
      // Given
      const form = createForm({ code: "12" });
      renderStep(form);
      const input = screen.getByPlaceholderText("123456");

      // When
      await userEvent.type(input, "3");

      // Then
      expect(input).toHaveValue("12");
      expect(form.setCode).toHaveBeenCalledWith("123");
    });

    it("errorがあれば全体のエラーを描く", () => {
      // Given
      const form = createForm({ error: "全体のエラー" });

      // When
      renderStep(form);

      // Then
      expect(screen.getByText("全体のエラー")).toBeInTheDocument();
    });
  });

  describe("エラー文の結びつき", () => {
    it("コードのエラー文の要素のidをidPrefixから作り、入力欄と結びつける", () => {
      // Given
      const form = createForm({ codeFieldErrors: { code: "コードのエラー" } });

      // When
      renderStep(form, "reset-password");

      // Then
      const input = screen.getByPlaceholderText("123456");
      expect(screen.getByText("コードのエラー")).toHaveAttribute(
        "id",
        "reset-password-code-error",
      );
      expect(input).toHaveAttribute(
        "aria-describedby",
        "reset-password-code-error",
      );
      expect(input).toHaveAttribute("aria-invalid", "true");
    });

    it("コードのエラーがないとき、入力欄を結びつけない", () => {
      // Given
      const form = createForm();

      // When
      renderStep(form);

      // Then
      const input = screen.getByPlaceholderText("123456");
      expect(input).not.toHaveAttribute("aria-describedby");
      expect(input).toHaveAttribute("aria-invalid", "false");
    });

    it("再送のエラーを再送の欄に表示する", () => {
      // Given
      const form = createForm({ codeFieldErrors: { resend: "再送のエラー" } });

      // When
      renderStep(form);

      // Then
      expect(screen.getByText("再送のエラー")).toBeInTheDocument();
    });
  });

  describe("操作", () => {
    it("確認の送信でhandleVerifyCodeを呼ぶ", () => {
      // Given
      const form = createForm();
      renderStep(form);

      // When
      fireEvent.submit(screen.getByPlaceholderText("123456"));

      // Then
      expect(form.handleVerifyCode).toHaveBeenCalledTimes(1);
    });

    it("再送を押すとhandleResendを呼ぶ", async () => {
      // Given
      const form = createForm();
      renderStep(form);

      // When
      await userEvent.click(screen.getByRole("button", { name: "再送" }));

      // Then
      expect(form.handleResend).toHaveBeenCalledTimes(1);
    });

    it("戻るを押すとhandleBackを呼ぶ", async () => {
      // Given
      const form = createForm();
      renderStep(form);

      // When
      await userEvent.click(screen.getByRole("button", { name: "戻る" }));

      // Then
      expect(form.handleBack).toHaveBeenCalledTimes(1);
    });
  });

  describe("処理中の表示", () => {
    it("処理中でないとき、3つのボタンはaria-disabledでなくスピナーも出ない", () => {
      // Given
      const form = createForm({ codeStepPending: null });

      // When
      renderStep(form);

      // Then
      for (const name of ["確認", "再送", "戻る"]) {
        const button = screen.getByRole("button", { name });
        expect(button, name).toHaveAttribute("aria-disabled", "false");
      }
      expect(
        screen.getByRole("button", { name: "確認" }).querySelector("svg"),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "再送" }).querySelector("svg"),
      ).toBeNull();
    });

    it("確認の処理中は、3つのボタンをaria-disabledにし、確認だけにスピナーを出す", () => {
      // Given
      const form = createForm({ codeStepPending: "verify" });

      // When
      renderStep(form);

      // Then
      for (const name of ["確認", "再送", "戻る"]) {
        expect(screen.getByRole("button", { name }), name).toHaveAttribute(
          "aria-disabled",
          "true",
        );
      }
      expect(
        screen.getByRole("button", { name: "確認" }).querySelector("svg"),
      ).not.toBeNull();
      expect(
        screen.getByRole("button", { name: "再送" }).querySelector("svg"),
      ).toBeNull();
    });

    it("再送の処理中は、3つのボタンをaria-disabledにし、再送だけにスピナーを出す", () => {
      // Given
      const form = createForm({ codeStepPending: "resend" });

      // When
      renderStep(form);

      // Then
      for (const name of ["確認", "再送", "戻る"]) {
        expect(screen.getByRole("button", { name }), name).toHaveAttribute(
          "aria-disabled",
          "true",
        );
      }
      expect(
        screen.getByRole("button", { name: "再送" }).querySelector("svg"),
      ).not.toBeNull();
      expect(
        screen.getByRole("button", { name: "確認" }).querySelector("svg"),
      ).toBeNull();
    });
  });

  describe("再送ボタンの表示", () => {
    it("クールダウンの境界（0/1秒）で、1秒のみ残り秒数を表示する", () => {
      // Given
      const zero = createForm({ resendCooldown: 0 });
      const one = createForm({ resendCooldown: 1 });

      // When
      const { unmount } = renderStep(zero);
      const zeroLabel = screen.getByRole("button", {
        name: /^再送/,
      }).textContent;
      unmount();
      renderStep(one);
      const oneLabel = screen.getByRole("button", {
        name: /^再送/,
      }).textContent;

      // Then
      expect(zeroLabel).toBe("再送");
      expect(oneLabel).toBe("再送（1秒）");
    });

    it("captchaTokenの有無をdata-captcha-readyに反映する", () => {
      // Given
      const ready = createForm({ captchaToken: "token" });
      const notReady = createForm({ captchaToken: null });

      // When
      const { unmount } = renderStep(ready);
      const readyValue = screen
        .getByRole("button", { name: "再送" })
        .getAttribute("data-captcha-ready");
      unmount();
      renderStep(notReady);
      const notReadyValue = screen
        .getByRole("button", { name: "再送" })
        .getAttribute("data-captcha-ready");

      // Then
      expect(readyValue).toBe("true");
      expect(notReadyValue).toBe("false");
    });
  });
});
