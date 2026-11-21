import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlTestProvider } from "@/i18n/intl-test-helpers";
import { translatorFor } from "@/i18n/translator-test-helpers";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import type { CallResult } from "../application/call-result";
import type { CodeVerification } from "../application/email-otp";
import { createFakePageAddress } from "../application/fake-page-address-test-helpers";
import { createGoogleSignIn } from "../application/google-sign-in";
import { createFakeGoogleSignInAuthenticator } from "../application/google-sign-in-test-helpers";
import { createSignIn } from "../application/sign-in";
import { signInHref } from "../domain/auth-routes";
import { SignInForm } from "./signin-form";

const authText = translatorFor("auth");

const accepted: CallResult = { kind: "accepted" };

const widget = vi.hoisted(() => ({
  onVerify: undefined as ((token: string | null) => void) | undefined,
}));

// セキュリティチェックは外部のウィジェットのため、トークンを発行できる代役に差し替える。
vi.mock("./turnstile", () => ({
  Turnstile: forwardRef<unknown, { onVerify: (token: string | null) => void }>(
    function TurnstileStub({ onVerify }, ref) {
      widget.onVerify = onVerify;
      useImperativeHandle(ref, () => ({ reset: () => {} }));
      return null;
    },
  ),
}));

const FROM = "/rounds/history#settings/account";

function setup(options: { search?: string; offline?: boolean } = {}) {
  const authenticator = {
    sendCode: vi.fn(async (): Promise<CallResult> => accepted),
    verifyCode: vi.fn(
      async (): Promise<CodeVerification> => ({ kind: "verified" }),
    ),
  };
  const googleAuthenticator = createFakeGoogleSignInAuthenticator();
  const pageReplace = { replace: vi.fn() };
  const address = createFakePageAddress(options.search ?? "");
  const connectivity = createFakeConnectivity(options.offline ?? false);
  const signIn = createSignIn({
    authenticator,
    pageReplace,
    clock: createManualClock(),
    connectivity,
  });
  const googleSignIn = createGoogleSignIn({
    authenticator: googleAuthenticator,
    address,
    pageReplace,
    connectivity,
  });
  const render_ = () =>
    render(
      <SignInForm
        signIn={signIn}
        googleSignIn={googleSignIn}
        siteKey="site-key"
        readReturnTo={() => FROM}
      />,
      { wrapper: IntlTestProvider },
    );
  return { authenticator, googleAuthenticator, pageReplace, render: render_ };
}

function googleButton() {
  return screen.getByRole("button", { name: authText("googleContinue") });
}

async function sendEmail(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByPlaceholderText(authText("emailPlaceholder")),
    "archer@example.test",
  );
  act(() => widget.onVerify?.("check"));
  await user.click(
    screen.getByRole("button", { name: authText("emailContinue") }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  widget.onVerify = undefined;
});

describe("SignInForm", () => {
  it("見出しを持たず、送付ボタンを「メールで続ける」で共通フォームに渡す", () => {
    // Given
    const h = setup();

    // When
    h.render();

    // Then
    expect(
      screen.getByRole("button", { name: authText("emailContinue") }),
    ).toBeVisible();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  describe("「Googleで続ける」", () => {
    it("メール入力の段階に置く", () => {
      // Given
      const h = setup();

      // When
      h.render();

      // Then
      expect(googleButton()).toBeVisible();
    });

    it("コード入力の段階には置かない", async () => {
      // Given
      const h = setup();
      h.render();
      const user = userEvent.setup();

      // When
      await sendEmail(user);

      // Then
      await screen.findByPlaceholderText(authText("otpCodePlaceholder"));
      expect(
        screen.queryByRole("button", { name: authText("googleContinue") }),
      ).toBeNull();
    });

    it("チェックを待たず、遷移元を載せた戻り先でGoogleの認証を始め、OTPの送付は始めない", async () => {
      // Given
      const h = setup();
      h.render();
      const user = userEvent.setup();

      // When
      await user.click(googleButton());

      // Then
      expect(
        h.googleAuthenticator.startGoogleSignIn,
      ).toHaveBeenCalledExactlyOnceWith({ returnPath: signInHref(FROM) });
      expect(h.authenticator.sendCode).not.toHaveBeenCalled();
    });

    it("Googleが実行中でも、メールを入力してコードを送付できる", async () => {
      // Given
      const h = setup();
      h.googleAuthenticator.startGoogleSignIn.mockReturnValue(
        new Promise<CallResult>(() => {}),
      );
      h.render();
      const user = userEvent.setup();
      await user.click(googleButton());

      // When
      await sendEmail(user);

      // Then
      expect(h.authenticator.sendCode).toHaveBeenCalledExactlyOnceWith({
        email: "archer@example.test",
        captchaToken: "check",
        shouldCreateUser: true,
      });
    });

    it("取り消しの戻りでは何も示さず、ボタンを再び押せる", async () => {
      // Given
      const h = setup({
        search: "?error=access_denied&error_description=cancelled",
      });

      // When
      h.render();

      // Then
      await waitFor(() =>
        expect(googleButton()).toHaveAttribute("aria-disabled", "false"),
      );
      expect(
        screen.queryByText(authText("failure.google_auth_failed")),
      ).toBeNull();
    });

    it("失敗の戻りでは「Googleでの認証に失敗しました。」を示し、ボタンを再び押せる", async () => {
      // Given
      const h = setup({ search: "?error=server_error" });

      // When
      h.render();

      // Then
      expect(
        await screen.findByText("Googleでの認証に失敗しました。"),
      ).toBeVisible();
      expect(googleButton()).toHaveAttribute("aria-disabled", "false");
    });

    it("codeの戻りで処理中になり、交換に成功すると遷移元へ進む", async () => {
      // Given
      let finish: (result: CallResult) => void = () => {};
      const h = setup({ search: "?code=auth-code" });
      h.googleAuthenticator.exchangeGoogleCode.mockReturnValue(
        new Promise<CallResult>((resolve) => {
          finish = resolve;
        }),
      );

      // When
      h.render();

      // Then
      await waitFor(() =>
        expect(googleButton()).toHaveAttribute("aria-disabled", "true"),
      );
      expect(h.pageReplace.replace).not.toHaveBeenCalled();
      await act(async () => finish(accepted));
      expect(h.pageReplace.replace).toHaveBeenCalledExactlyOnceWith(FROM);
    });

    it("移動中にbfcacheで復元されると、処理中を解く", async () => {
      // Given
      const h = setup();
      h.googleAuthenticator.startGoogleSignIn.mockReturnValue(
        new Promise<CallResult>(() => {}),
      );
      h.render();
      const user = userEvent.setup();
      await user.click(googleButton());
      expect(googleButton()).toHaveAttribute("aria-disabled", "true");

      // When
      act(() => {
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true }),
        );
      });

      // Then
      expect(googleButton()).toHaveAttribute("aria-disabled", "false");
    });

    it("Googleにだけ残るアドレスでは、コード入力へ進まず案内を示し、ボタンを押せる", async () => {
      // Given
      const h = setup();
      h.authenticator.sendCode.mockResolvedValue({
        kind: "failed",
        failure: { kind: "google_only_address" },
      });
      h.render();
      const user = userEvent.setup();

      // When
      await sendEmail(user);

      // Then
      expect(
        await screen.findByText(authText("failure.google_only_address")),
      ).toBeVisible();
      expect(
        screen.queryByPlaceholderText(authText("otpCodePlaceholder")),
      ).toBeNull();
      expect(googleButton()).toHaveAttribute("aria-disabled", "false");
    });
  });
});
