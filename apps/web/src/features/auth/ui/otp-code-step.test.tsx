import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { AUTH_CODE_LENGTH } from "../domain/auth-code";
import { OtpCodeStep } from "./otp-code-step";

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックする。
vi.mock("@/components/turnstile", () => ({
  Turnstile: forwardRef(function TurnstileStub() {
    return <div data-testid="turnstile-stub" />;
  }),
}));

type Props = ComponentProps<typeof OtpCodeStep>;

function createForm(overrides: Partial<Props> = {}) {
  return {
    email: "user@example.com",
    code: "",
    onCodeChange: vi.fn(),
    codeError: undefined,
    resendError: undefined,
    pending: null,
    error: null,
    onBack: vi.fn(),
    onVerify: vi.fn((e) => e.preventDefault()),
    onResend: vi.fn(),
    checkRef: { current: undefined },
    onCheck: vi.fn(),
    checked: false,
    resendCooldown: 0,
    idPrefix: "test",
    ...overrides,
  } satisfies Props;
}

function renderStep(form: Props, idPrefix = form.idPrefix) {
  return render(<OtpCodeStep {...form} idPrefix={idPrefix} />);
}

describe("OtpCodeStep", () => {
  describe("表示", () => {
    it("見出しと、メールアドレスを含む説明と迷惑メールの案内を描く", () => {
      // Given

      // When
      const form = createForm({ email: "me@example.com" });
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

    it("codeの値を表示し、入力でonCodeChangeを呼ぶ", async () => {
      // Given
      const form = createForm({ code: "12" });
      renderStep(form);
      const input = screen.getByPlaceholderText("123456");

      // When
      await userEvent.type(input, "3");

      // Then
      expect(input).toHaveValue("12");
      expect(form.onCodeChange).toHaveBeenCalledWith("123");
    });

    it("errorがあれば全体のエラーを描く", () => {
      // Given

      // When
      const form = createForm({ error: "全体のエラー" });
      renderStep(form);

      // Then
      expect(screen.getByText("全体のエラー")).toBeInTheDocument();
    });
  });

  describe("入力欄", () => {
    it("コードの入力欄の最大長は、ドメインの認証コードの桁数である", () => {
      // Given

      // When
      renderStep(createForm());

      // Then
      const input = screen.getByPlaceholderText("123456");
      expect(input).toHaveAttribute("maxlength", String(AUTH_CODE_LENGTH));
    });
  });

  describe("エラー文の結びつき", () => {
    it("コードのエラー文の要素のidをidPrefixから作り、入力欄と結びつける", () => {
      // Given

      // When
      const form = createForm({ codeError: "コードのエラー" });
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

      // When
      const form = createForm();
      renderStep(form);

      // Then
      const input = screen.getByPlaceholderText("123456");
      expect(input).not.toHaveAttribute("aria-describedby");
      expect(input).toHaveAttribute("aria-invalid", "false");
    });

    it("再送のエラーを再送の欄に表示する", () => {
      // Given

      // When
      const form = createForm({ resendError: "再送のエラー" });
      renderStep(form);

      // Then
      expect(screen.getByText("再送のエラー")).toBeInTheDocument();
    });
  });

  describe("操作", () => {
    it("確認の送信でonVerifyを呼ぶ", () => {
      // Given
      const form = createForm();
      renderStep(form);

      // When
      fireEvent.submit(screen.getByPlaceholderText("123456"));

      // Then
      expect(form.onVerify).toHaveBeenCalledTimes(1);
    });

    it("再送を押すとonResendを呼ぶ", async () => {
      // Given
      const form = createForm();
      renderStep(form);

      // When
      await userEvent.click(screen.getByRole("button", { name: "再送" }));

      // Then
      expect(form.onResend).toHaveBeenCalledTimes(1);
    });

    it("戻るを押すとonBackを呼ぶ", async () => {
      // Given
      const form = createForm();
      renderStep(form);

      // When
      await userEvent.click(screen.getByRole("button", { name: "戻る" }));

      // Then
      expect(form.onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe("処理中の表示", () => {
    it("処理中でないとき、3つのボタンはaria-disabledでなくスピナーも出ない", () => {
      // Given

      // When
      const form = createForm({ pending: null });
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

      // When
      const form = createForm({ pending: "verify" });
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

      // When
      const form = createForm({ pending: "resend" });
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

      // When
      const zero = createForm({ resendCooldown: 0 });
      const one = createForm({ resendCooldown: 1 });
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

    it("セキュリティチェックの完了をdata-captcha-readyに反映する", () => {
      // Given

      // When
      const ready = createForm({ checked: true });
      const notReady = createForm({ checked: false });
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
