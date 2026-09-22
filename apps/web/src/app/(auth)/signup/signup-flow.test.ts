import type { AuthError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  initialSignUpState,
  type SignUpState,
  signupReducer,
} from "./signup-flow";

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";

function makeAuthError(code: string, message = "x"): AuthError {
  return { code, message } as AuthError;
}

function stateWith(overrides: Partial<SignUpState>): SignUpState {
  return { ...initialSignUpState, ...overrides };
}

describe("signupReducer", () => {
  it("reset_to_emailはstepをemailへ戻し、error・codeFieldErrorsをクリアするが他は変更しない", () => {
    const state = stateWith({
      step: "code",
      error: "何かのエラー",
      codeFieldErrors: { code: "認証コードを入力してください。" },
      emailFieldErrors: { email: "触れられない" },
      resendCooldown: 30,
    });

    const next = signupReducer(state, { type: "reset_to_email" });

    expect(next.step).toBe("email");
    expect(next.error).toBeNull();
    expect(next.codeFieldErrors).toEqual({});
    expect(next.emailFieldErrors).toEqual({ email: "触れられない" });
    expect(next.resendCooldown).toBe(30);
  });

  describe("resend_tick", () => {
    it("resendCooldownを1減らす", () => {
      const next = signupReducer(stateWith({ resendCooldown: 5 }), {
        type: "resend_tick",
      });
      expect(next.resendCooldown).toBe(4);
    });

    it("1から0になる境界でも正しく減らす", () => {
      const next = signupReducer(stateWith({ resendCooldown: 1 }), {
        type: "resend_tick",
      });
      expect(next.resendCooldown).toBe(0);
    });
  });

  describe("send_code_*", () => {
    it("send_code_invalidはerrorをクリアしemailFieldErrorsを差し替える", () => {
      const state = stateWith({ error: "前回のエラー" });
      const next = signupReducer(state, {
        type: "send_code_invalid",
        errors: { email: "メールアドレスを入力してください。" },
      });
      expect(next.error).toBeNull();
      expect(next.emailFieldErrors).toEqual({
        email: "メールアドレスを入力してください。",
      });
    });

    it("send_code_invalidはcaptchaエラーも表現できる", () => {
      const next = signupReducer(initialSignUpState, {
        type: "send_code_invalid",
        errors: { captcha: "セキュリティチェックが完了していません。" },
      });
      expect(next.emailFieldErrors).toEqual({
        captcha: "セキュリティチェックが完了していません。",
      });
    });

    it("send_code_startedはerror・emailFieldErrorsをクリアする（前回の失敗を引きずらない）", () => {
      const state = stateWith({
        error: "前回のエラー",
        emailFieldErrors: { email: "stale" },
      });
      const next = signupReducer(state, { type: "send_code_started" });
      expect(next.error).toBeNull();
      expect(next.emailFieldErrors).toEqual({});
    });

    it("send_code_already_registeredは専用メッセージを表示しemailFieldErrorsをクリアする", () => {
      const state = stateWith({ emailFieldErrors: { email: "stale" } });
      const next = signupReducer(state, {
        type: "send_code_already_registered",
      });
      expect(next.error).toBe("このメールアドレスは既に登録されています。");
      expect(next.emailFieldErrors).toEqual({});
    });

    it("send_code_succeededはcodeステップへ進みcooldownを60にする", () => {
      const state = stateWith({
        error: "前回のエラー",
        emailFieldErrors: { email: "stale" },
      });
      const next = signupReducer(state, { type: "send_code_succeeded" });
      expect(next.step).toBe("code");
      expect(next.resendCooldown).toBe(60);
      expect(next.error).toBeNull();
      expect(next.emailFieldErrors).toEqual({});
    });

    it("send_code_auth_errorはtranslateAuthErrorMessageの結果をerrorに設定する", () => {
      const next = signupReducer(initialSignUpState, {
        type: "send_code_auth_error",
        error: makeAuthError("otp_expired"),
      });
      expect(next.error).toBe(
        "認証コードが正しくないか、有効期限が切れています。",
      );
      expect(next.emailFieldErrors).toEqual({});
      expect(next.step).toBe("email");
    });

    it("send_code_network_errorは通信エラーメッセージを設定する", () => {
      const next = signupReducer(initialSignUpState, {
        type: "send_code_network_error",
      });
      expect(next.error).toBe(NETWORK_ERROR_MESSAGE);
      expect(next.emailFieldErrors).toEqual({});
    });
  });

  describe("verify_code_*", () => {
    it("verify_code_invalidはerrorをクリアしcodeFieldErrorsを差し替える", () => {
      const state = stateWith({ error: "前回のエラー" });
      const next = signupReducer(state, {
        type: "verify_code_invalid",
        errors: { code: "認証コードを入力してください。" },
      });
      expect(next.error).toBeNull();
      expect(next.codeFieldErrors).toEqual({
        code: "認証コードを入力してください。",
      });
    });

    it("verify_code_startedはerror・codeFieldErrorsをクリアする（前回の失敗を引きずらない）", () => {
      const state = stateWith({
        step: "code",
        error: "前回のエラー",
        codeFieldErrors: { code: "stale" },
      });
      const next = signupReducer(state, { type: "verify_code_started" });
      expect(next.error).toBeNull();
      expect(next.codeFieldErrors).toEqual({});
    });

    it("verify_code_succeededはpasswordステップへ進む", () => {
      const state = stateWith({
        step: "code",
        codeFieldErrors: { code: "stale" },
      });
      const next = signupReducer(state, { type: "verify_code_succeeded" });
      expect(next.step).toBe("password");
      expect(next.error).toBeNull();
      expect(next.codeFieldErrors).toEqual({});
    });

    it("verify_code_auth_errorはtranslateAuthErrorMessageの結果をerrorに設定する", () => {
      const next = signupReducer(stateWith({ step: "code" }), {
        type: "verify_code_auth_error",
        error: makeAuthError("otp_expired"),
      });
      expect(next.error).toBe(
        "認証コードが正しくないか、有効期限が切れています。",
      );
      expect(next.codeFieldErrors).toEqual({});
      expect(next.step).toBe("code");
    });

    it("verify_code_network_errorは通信エラーメッセージを設定する", () => {
      const next = signupReducer(stateWith({ step: "code" }), {
        type: "verify_code_network_error",
      });
      expect(next.error).toBe(NETWORK_ERROR_MESSAGE);
      expect(next.codeFieldErrors).toEqual({});
    });
  });

  describe("resend_*", () => {
    it("resend_invalidはerrorをクリアしcodeFieldErrorsに再送エラーを設定する", () => {
      const state = stateWith({ step: "code", error: "前回のエラー" });
      const next = signupReducer(state, {
        type: "resend_invalid",
        errors: {
          resend:
            "再送はクールダウン中です。しばらくしてから再度お試しください。",
        },
      });
      expect(next.error).toBeNull();
      expect(next.codeFieldErrors).toEqual({
        resend:
          "再送はクールダウン中です。しばらくしてから再度お試しください。",
      });
    });

    it("resend_startedはerror・codeFieldErrorsをクリアしcooldownを60にする", () => {
      const state = stateWith({
        step: "code",
        error: "前回のエラー",
        codeFieldErrors: { resend: "stale" },
      });
      const next = signupReducer(state, { type: "resend_started" });
      expect(next.error).toBeNull();
      expect(next.codeFieldErrors).toEqual({});
      expect(next.resendCooldown).toBe(60);
    });

    it("resend_auth_errorはtranslateAuthErrorMessageの結果をerrorに設定しcodeFieldErrorsには触れない", () => {
      const state = stateWith({ step: "code", codeFieldErrors: {} });
      const next = signupReducer(state, {
        type: "resend_auth_error",
        error: makeAuthError("otp_expired"),
      });
      expect(next.error).toBe(
        "認証コードが正しくないか、有効期限が切れています。",
      );
      expect(next.codeFieldErrors).toEqual({});
    });
  });

  describe("set_password_*", () => {
    it("set_password_invalidはerrorをクリアしpasswordFieldErrorsを差し替える", () => {
      const state = stateWith({ step: "password", error: "前回のエラー" });
      const next = signupReducer(state, {
        type: "set_password_invalid",
        errors: { password: "パスワードを入力してください。" },
      });
      expect(next.error).toBeNull();
      expect(next.passwordFieldErrors).toEqual({
        password: "パスワードを入力してください。",
      });
    });

    it("set_password_startedはerror・passwordFieldErrorsをクリアする（前回の失敗を引きずらない）", () => {
      const state = stateWith({
        step: "password",
        error: "前回のエラー",
        passwordFieldErrors: { password: "stale" },
      });
      const next = signupReducer(state, { type: "set_password_started" });
      expect(next.error).toBeNull();
      expect(next.passwordFieldErrors).toEqual({});
    });

    it("set_password_auth_errorはtranslateAuthErrorMessageの結果をerrorに設定する", () => {
      const state = stateWith({ step: "password" });
      const next = signupReducer(state, {
        type: "set_password_auth_error",
        error: makeAuthError("weak_password"),
      });
      expect(next.error).toBe(
        "パスワードは8文字以上で、英字と数字の両方を含めてください。",
      );
      expect(next.passwordFieldErrors).toEqual({});
    });

    it("set_password_network_errorは通信エラーメッセージを設定する", () => {
      const next = signupReducer(stateWith({ step: "password" }), {
        type: "set_password_network_error",
      });
      expect(next.error).toBe(NETWORK_ERROR_MESSAGE);
      expect(next.passwordFieldErrors).toEqual({});
    });
  });
});
