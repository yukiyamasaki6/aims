import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { FlowOtpCodeStep } from "./flow-otp-code-step";

const authText = translatorFor("auth");

const widget = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
  onFailed: undefined as (() => void) | undefined,
}));

// 外部のTurnstileウィジェット（iframe）を包むコンポーネントのため境界としてモックする。
vi.mock("./turnstile", () => ({
  Turnstile: forwardRef<
    unknown,
    { onVerify: (token: string | null) => void; onFailed: () => void }
  >(function TurnstileStub({ onVerify, onFailed }) {
    widget.onVerify = onVerify;
    widget.onFailed = onFailed;
    return <div data-testid="turnstile-stub" />;
  }),
}));

type Props = ComponentProps<typeof FlowOtpCodeStep>;
type State = Props["screen"]["state"];

function createStep(state: Partial<State> = {}) {
  const dispatch = vi.fn();
  const props = {
    idPrefix: "test",
    email: "archer@example.test",
    screen: {
      state: {
        fieldErrors: {},
        pending: null,
        error: null,
        resendCooldown: 0,
        ...state,
      },
      view: { dispatch },
      checkRef: { current: undefined },
    },
    siteKey: "site-key",
    checkProps: { waiting: false, onFailed: vi.fn() },
    verifyLabel: authText("otpVerify"),
    verifyVariant: "default",
    onVerify: vi.fn(),
    onResend: vi.fn(),
  } satisfies Props;
  return { props, dispatch };
}

function renderStep(props: Props) {
  return render(<FlowOtpCodeStep {...props} />, { wrapper: IntlTestProvider });
}

function codeInput() {
  return screen.getByPlaceholderText(authText("otpCodePlaceholder"));
}

describe("FlowOtpCodeStep", () => {
  describe("流れの状態の表示", () => {
    it("送付先と、渡された確認ボタンの文言を描く", () => {
      // Given

      // When
      const { props } = createStep();
      renderStep({ ...props, verifyLabel: authText("deleteAccountVerify") });

      // Then
      expect(screen.getByText(/archer@example\.test/)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: authText("deleteAccountVerify") }),
      ).toBeInTheDocument();
    });

    it("流れの失敗とコード・再送の不備を、それぞれの文言で描く", () => {
      // Given

      // When
      const { props } = createStep({
        error: "code_expired",
        fieldErrors: { code: "required", resend: "cooldown" },
      });
      renderStep(props);

      // Then
      expect(
        screen.getByText(authText("failure.code_expired")),
      ).toBeInTheDocument();
      expect(
        screen.getByText(authText("fieldError.code.required")),
      ).toBeInTheDocument();
      expect(
        screen.getByText(authText("fieldError.resend.cooldown")),
      ).toBeInTheDocument();
    });

    it("流れの再送待機の残り秒数を、再送ボタンに描く", () => {
      // Given

      // When
      const { props } = createStep({ resendCooldown: 42 });
      renderStep(props);

      // Then
      expect(
        screen.getByRole("button", {
          name: authText("otpResendWait", { seconds: "42" }),
        }),
      ).toBeInTheDocument();
    });

    it("流れが処理中のとき、本文の「戻る」を押せない状態にする", () => {
      // Given

      // When
      const { props } = createStep({ pending: "verify" });
      renderStep(props);

      // Then
      expect(
        screen.getByRole("button", { name: authText("back") }),
      ).toHaveAttribute("aria-disabled", "true");
    });
  });

  describe("操作の接続", () => {
    it("入力したコードを持ち、確認の送信で、そのコードをonVerifyへ渡す", async () => {
      // Given
      const { props } = createStep();
      renderStep(props);
      const user = userEvent.setup();

      // When
      await user.type(codeInput(), "123456{Enter}");

      // Then
      expect(props.onVerify).toHaveBeenCalledExactlyOnceWith("123456");
    });

    it("本文の「戻る」を押すと、流れへ戻る出来事を送る", async () => {
      // Given
      const { props, dispatch } = createStep();
      renderStep(props);
      const user = userEvent.setup();

      // When
      await user.click(screen.getByRole("button", { name: authText("back") }));

      // Then
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({
        type: "emailStepReturned",
      });
    });

    it("再送を押すとonResendを呼ぶ", async () => {
      // Given
      const { props } = createStep();
      renderStep(props);
      const user = userEvent.setup();

      // When
      await user.click(
        screen.getByRole("button", { name: authText("otpResend") }),
      );

      // Then
      expect(props.onResend).toHaveBeenCalledTimes(1);
    });

    it("チェックの完了を流れへ送り、チェックの失敗をcheckPropsの通知先へ渡す", () => {
      // Given
      const { props, dispatch } = createStep();
      renderStep(props);

      // When
      widget.onVerify?.("check");
      widget.onFailed?.();

      // Then
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({
        type: "captchaChecked",
        token: "check",
      });
      expect(props.checkProps.onFailed).toHaveBeenCalledTimes(1);
    });

    it("再送待機が始めの秒数に戻る(再送が受理された)と、入力したコードを消す", async () => {
      // Given
      const { props } = createStep({ resendCooldown: 0 });
      const { rerender } = renderStep(props);
      const user = userEvent.setup();
      await user.type(codeInput(), "123");

      // When
      rerender(
        <FlowOtpCodeStep
          {...props}
          screen={{
            ...props.screen,
            state: { ...props.screen.state, resendCooldown: 60 },
          }}
        />,
      );

      // Then
      expect(codeInput()).toHaveValue("");
    });
  });
});
