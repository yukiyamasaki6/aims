import type { AuthError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialSignUpState,
  type SignUpAction,
  type SignUpState,
  signupReducer,
} from "./signup-flow";

// translateAuthErrorMessage（errors.test.tsで検証済み）は、このテストを削除してもテスト対象以外のカバレッジに影響しないように、別モジュールとの境界としてモックする。
const errors = vi.hoisted(() => ({
  translateAuthErrorMessage: vi.fn<(error: AuthError) => string>(),
}));
vi.mock("@/features/auth/errors", () => ({
  translateAuthErrorMessage: errors.translateAuthErrorMessage,
}));

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";

function makeAuthError(code: string, message = "x"): AuthError {
  return { code, message } as AuthError;
}

function stateWith(overrides: Partial<SignUpState>): SignUpState {
  return { ...initialSignUpState, ...overrides };
}

describe("signupReducer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialSignUpState", () => {
    it("codeStepPendingはnull（確認・再送のいずれも通信中でない）", () => {
      // Given
      const state = initialSignUpState;

      // When
      const { codeStepPending } = state;

      // Then
      expect(codeStepPending).toBeNull();
    });
  });

  describe("send_code_*", () => {
    it("send_code_startedはerror・emailFieldErrorsをクリアする（前回の失敗を引きずらない）", () => {
      // Given
      const state = stateWith({
        error: "前回のエラー",
        emailFieldErrors: { email: "stale" },
      });

      // When
      const next = signupReducer(state, { type: "send_code_started" });

      // Then
      expect(next.error).toBeNull();
      expect(next.emailFieldErrors).toEqual({});
    });

    it("send_code_succeededはcodeステップへ進みcooldownを60にする", () => {
      // Given
      const state = stateWith({
        error: "前回のエラー",
        emailFieldErrors: { email: "stale" },
      });

      // When
      const next = signupReducer(state, { type: "send_code_succeeded" });

      // Then
      expect(next.step).toBe("code");
      expect(next.resendCooldown).toBe(60);
      expect(next.error).toBeNull();
      expect(next.emailFieldErrors).toEqual({});
    });

    it("send_code_invalidはerrorをクリアしemailFieldErrorsを差し替える", () => {
      // Given
      const state = stateWith({ error: "前回のエラー" });

      // When
      const next = signupReducer(state, {
        type: "send_code_invalid",
        errors: { email: "メールアドレスを入力してください。" },
      });

      // Then
      expect(next.error).toBeNull();
      expect(next.emailFieldErrors).toEqual({
        email: "メールアドレスを入力してください。",
      });
    });

    it("send_code_invalidはcaptchaエラーも表現できる", () => {
      // Given
      const state = initialSignUpState;

      // When
      const next = signupReducer(state, {
        type: "send_code_invalid",
        errors: { captcha: "セキュリティチェックが完了していません。" },
      });

      // Then
      expect(next.emailFieldErrors).toEqual({
        captcha: "セキュリティチェックが完了していません。",
      });
    });

    it("send_code_already_registeredは専用メッセージを表示しemailFieldErrorsをクリアする", () => {
      // Given
      const state = stateWith({ emailFieldErrors: { email: "stale" } });

      // When
      const next = signupReducer(state, {
        type: "send_code_already_registered",
      });

      // Then
      expect(next.error).toBe("このメールアドレスは既に登録されています。");
      expect(next.emailFieldErrors).toEqual({});
    });

    it("send_code_auth_errorはtranslateAuthErrorMessageの結果をerrorに設定する", () => {
      // Given
      const state = initialSignUpState;
      const error = makeAuthError("otp_expired");
      errors.translateAuthErrorMessage.mockReturnValue("翻訳済みメッセージ");

      // When
      const next = signupReducer(state, {
        type: "send_code_auth_error",
        error,
      });

      // Then
      expect(errors.translateAuthErrorMessage).toHaveBeenCalledWith(error);
      expect(next.error).toBe("翻訳済みメッセージ");
      expect(next.emailFieldErrors).toEqual({});
      expect(next.step).toBe("email");
    });

    it("send_code_network_errorは通信エラーメッセージを設定する", () => {
      // Given
      const state = initialSignUpState;

      // When
      const next = signupReducer(state, { type: "send_code_network_error" });

      // Then
      expect(next.error).toBe(NETWORK_ERROR_MESSAGE);
      expect(next.emailFieldErrors).toEqual({});
    });
  });

  describe("verify_code_*", () => {
    it("verify_code_startedはerror・codeFieldErrorsをクリアする（前回の失敗を引きずらない）", () => {
      // Given
      const state = stateWith({
        step: "code",
        error: "前回のエラー",
        codeFieldErrors: { code: "stale" },
      });

      // When
      const next = signupReducer(state, { type: "verify_code_started" });

      // Then
      expect(next.error).toBeNull();
      expect(next.codeFieldErrors).toEqual({});
    });

    it("verify_code_succeededはpasswordステップへ進む", () => {
      // Given
      const state = stateWith({
        step: "code",
        codeFieldErrors: { code: "stale" },
      });

      // When
      const next = signupReducer(state, { type: "verify_code_succeeded" });

      // Then
      expect(next.step).toBe("password");
      expect(next.error).toBeNull();
      expect(next.codeFieldErrors).toEqual({});
    });

    it("verify_code_invalidはerrorをクリアしcodeFieldErrorsを差し替える", () => {
      // Given
      const state = stateWith({ error: "前回のエラー" });

      // When
      const next = signupReducer(state, {
        type: "verify_code_invalid",
        errors: { code: "認証コードを入力してください。" },
      });

      // Then
      expect(next.error).toBeNull();
      expect(next.codeFieldErrors).toEqual({
        code: "認証コードを入力してください。",
      });
    });

    it("verify_code_auth_errorはtranslateAuthErrorMessageの結果をerrorに設定する", () => {
      // Given
      const state = stateWith({ step: "code" });
      const error = makeAuthError("otp_expired");
      errors.translateAuthErrorMessage.mockReturnValue("翻訳済みメッセージ");

      // When
      const next = signupReducer(state, {
        type: "verify_code_auth_error",
        error,
      });

      // Then
      expect(errors.translateAuthErrorMessage).toHaveBeenCalledWith(error);
      expect(next.error).toBe("翻訳済みメッセージ");
      expect(next.codeFieldErrors).toEqual({});
      expect(next.step).toBe("code");
    });

    it("verify_code_network_errorは通信エラーメッセージを設定する", () => {
      // Given
      const state = stateWith({ step: "code" });

      // When
      const next = signupReducer(state, {
        type: "verify_code_network_error",
      });

      // Then
      expect(next.error).toBe(NETWORK_ERROR_MESSAGE);
      expect(next.codeFieldErrors).toEqual({});
    });

    it("verify_code_startedはcodeStepPendingをverifyにする", () => {
      // Given
      const state = stateWith({ step: "code", codeStepPending: null });

      // When
      const next = signupReducer(state, { type: "verify_code_started" });

      // Then
      expect(next.codeStepPending).toBe("verify");
    });

    it.each<SignUpAction>([
      { type: "verify_code_succeeded" },
      { type: "verify_code_auth_error", error: makeAuthError("otp_expired") },
      { type: "verify_code_network_error" },
    ])("$typeはcodeStepPendingをnullに戻す", (action) => {
      // Given
      const state = stateWith({ step: "code", codeStepPending: "verify" });

      // When
      const next = signupReducer(state, action);

      // Then
      expect(next.codeStepPending).toBeNull();
    });
  });

  describe("resend_*", () => {
    it("resend_startedはerror・codeFieldErrorsをクリアしcooldownを60にする", () => {
      // Given
      const state = stateWith({
        step: "code",
        error: "前回のエラー",
        codeFieldErrors: { resend: "stale" },
      });

      // When
      const next = signupReducer(state, { type: "resend_started" });

      // Then
      expect(next.error).toBeNull();
      expect(next.codeFieldErrors).toEqual({});
      expect(next.resendCooldown).toBe(60);
    });

    it("resend_invalidはerrorをクリアしcodeFieldErrorsに再送エラーを設定する", () => {
      // Given
      const state = stateWith({ step: "code", error: "前回のエラー" });
      const cooldownMessage =
        "再送はクールダウン中です。しばらくしてから再度お試しください。";

      // When
      const next = signupReducer(state, {
        type: "resend_invalid",
        errors: { resend: cooldownMessage },
      });

      // Then
      expect(next.error).toBeNull();
      expect(next.codeFieldErrors).toEqual({ resend: cooldownMessage });
    });

    it("resend_auth_errorはtranslateAuthErrorMessageの結果をerrorに設定しcodeFieldErrorsには触れない", () => {
      // Given
      const codeFieldErrors = { code: "認証コードを入力してください。" };
      const state = stateWith({ step: "code", codeFieldErrors });
      const error = makeAuthError("otp_expired");
      errors.translateAuthErrorMessage.mockReturnValue("翻訳済みメッセージ");

      // When
      const next = signupReducer(state, {
        type: "resend_auth_error",
        error,
      });

      // Then
      expect(errors.translateAuthErrorMessage).toHaveBeenCalledWith(error);
      expect(next.error).toBe("翻訳済みメッセージ");
      expect(next.codeFieldErrors).toEqual(codeFieldErrors);
    });

    it("resend_network_errorは通信エラーメッセージを設定する", () => {
      // Given
      const state = stateWith({ step: "code" });

      // When
      const next = signupReducer(state, { type: "resend_network_error" });

      // Then
      expect(next.error).toBe(NETWORK_ERROR_MESSAGE);
    });

    it("resend_startedはcodeStepPendingをresendにする", () => {
      // Given
      const state = stateWith({ step: "code", codeStepPending: null });

      // When
      const next = signupReducer(state, { type: "resend_started" });

      // Then
      expect(next.codeStepPending).toBe("resend");
    });

    it("resend_succeededはcodeStepPendingをnullに戻し、それ以外の状態は変更しない", () => {
      // Given
      const state = stateWith({
        step: "code",
        error: "何かのエラー",
        codeFieldErrors: { code: "認証コードを入力してください。" },
        resendCooldown: 60,
        codeStepPending: "resend",
      });

      // When
      const next = signupReducer(state, { type: "resend_succeeded" });

      // Then
      expect(next).toEqual({ ...state, codeStepPending: null });
    });

    it.each<SignUpAction>([
      { type: "resend_auth_error", error: makeAuthError("captcha_failed") },
      { type: "resend_network_error" },
    ])("$typeはcodeStepPendingをnullに戻す", (action) => {
      // Given
      const state = stateWith({ step: "code", codeStepPending: "resend" });

      // When
      const next = signupReducer(state, action);

      // Then
      expect(next.codeStepPending).toBeNull();
    });
  });

  describe("resend_tick", () => {
    it("resendCooldownを1減らす", () => {
      // Given
      const state = stateWith({ resendCooldown: 5 });

      // When
      const next = signupReducer(state, { type: "resend_tick" });

      // Then
      expect(next.resendCooldown).toBe(4);
    });

    it("1から0になる境界でも正しく減らす", () => {
      // Given
      const state = stateWith({ resendCooldown: 1 });

      // When
      const next = signupReducer(state, { type: "resend_tick" });

      // Then
      expect(next.resendCooldown).toBe(0);
    });
  });

  describe("set_password_*", () => {
    it("set_password_startedはerror・passwordFieldErrorsをクリアする（前回の失敗を引きずらない）", () => {
      // Given
      const state = stateWith({
        step: "password",
        error: "前回のエラー",
        passwordFieldErrors: { password: "stale" },
      });

      // When
      const next = signupReducer(state, { type: "set_password_started" });

      // Then
      expect(next.error).toBeNull();
      expect(next.passwordFieldErrors).toEqual({});
    });

    it("set_password_invalidはerrorをクリアしpasswordFieldErrorsを差し替える", () => {
      // Given
      const state = stateWith({ step: "password", error: "前回のエラー" });

      // When
      const next = signupReducer(state, {
        type: "set_password_invalid",
        errors: { password: "パスワードを入力してください。" },
      });

      // Then
      expect(next.error).toBeNull();
      expect(next.passwordFieldErrors).toEqual({
        password: "パスワードを入力してください。",
      });
    });

    it("set_password_auth_errorはtranslateAuthErrorMessageの結果をerrorに設定する", () => {
      // Given
      const state = stateWith({ step: "password" });
      const error = makeAuthError("weak_password");
      errors.translateAuthErrorMessage.mockReturnValue("翻訳済みメッセージ");

      // When
      const next = signupReducer(state, {
        type: "set_password_auth_error",
        error,
      });

      // Then
      expect(errors.translateAuthErrorMessage).toHaveBeenCalledWith(error);
      expect(next.error).toBe("翻訳済みメッセージ");
      expect(next.passwordFieldErrors).toEqual({});
    });

    it("set_password_network_errorは通信エラーメッセージを設定する", () => {
      // Given
      const state = stateWith({ step: "password" });

      // When
      const next = signupReducer(state, {
        type: "set_password_network_error",
      });

      // Then
      expect(next.error).toBe(NETWORK_ERROR_MESSAGE);
      expect(next.passwordFieldErrors).toEqual({});
    });
  });

  it("reset_to_emailはstepをemailへ戻し、error・codeFieldErrorsをクリアするが他は変更しない", () => {
    // Given
    const state = stateWith({
      step: "code",
      error: "何かのエラー",
      codeFieldErrors: { code: "認証コードを入力してください。" },
      emailFieldErrors: { email: "触れられない" },
      resendCooldown: 30,
    });

    // When
    const next = signupReducer(state, { type: "reset_to_email" });

    // Then
    expect(next.step).toBe("email");
    expect(next.error).toBeNull();
    expect(next.codeFieldErrors).toEqual({});
    expect(next.emailFieldErrors).toEqual({ email: "触れられない" });
    expect(next.resendCooldown).toBe(30);
  });

  // 確認・再送の開始・終了以外のactionで通信中の状態が変わると、確認・再送・戻るの排他が崩れるため、いずれの値からも変更しないことを検証する。
  describe("確認・再送の開始・終了以外のaction", () => {
    const otherActions: SignUpAction[] = [
      { type: "reset_to_email" },
      { type: "resend_tick" },
      { type: "send_code_invalid", errors: { email: "x" } },
      { type: "send_code_started" },
      { type: "send_code_already_registered" },
      { type: "send_code_succeeded" },
      { type: "send_code_auth_error", error: makeAuthError("otp_expired") },
      { type: "send_code_network_error" },
      { type: "verify_code_invalid", errors: { code: "x" } },
      { type: "resend_invalid", errors: { resend: "x" } },
      { type: "set_password_invalid", errors: { password: "x" } },
      { type: "set_password_started" },
      {
        type: "set_password_auth_error",
        error: makeAuthError("weak_password"),
      },
      { type: "set_password_network_error" },
    ];

    describe.each<SignUpState["codeStepPending"]>([null, "verify", "resend"])(
      "codeStepPendingが%sの場合",
      (codeStepPending) => {
        it.each(otherActions)(
          "$typeはcodeStepPendingを変更しない",
          (action) => {
            // Given
            const state = stateWith({
              step: "code",
              resendCooldown: 5,
              codeStepPending,
            });

            // When
            const next = signupReducer(state, action);

            // Then
            expect(next.codeStepPending).toBe(codeStepPending);
          },
        );
      },
    );
  });
});
