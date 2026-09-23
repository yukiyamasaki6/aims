import type { AuthError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialSignInState,
  type SignInState,
  signinReducer,
} from "./signin-flow";

// translateAuthErrorMessage（errors.test.tsで検証済み）は、このテストを削除してもテスト対象以外のカバレッジに影響しないように、別モジュールとの境界としてモックする。
const errors = vi.hoisted(() => ({
  translateAuthErrorMessage: vi.fn<(error: AuthError) => string>(),
}));
vi.mock("@/lib/supabase/errors", () => ({
  translateAuthErrorMessage: errors.translateAuthErrorMessage,
}));

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";

function makeAuthError(code: string, message = "x"): AuthError {
  return { code, message } as AuthError;
}

function stateWith(overrides: Partial<SignInState>): SignInState {
  return { ...initialSignInState, ...overrides };
}

describe("signinReducer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submit_invalidはerrorをクリアしfieldErrorsを差し替える", () => {
    // Given
    const state = stateWith({
      error: "前回のエラー",
      fieldErrors: { password: "stale" },
    });

    // When
    const next = signinReducer(state, {
      type: "submit_invalid",
      errors: { email: "メールアドレスを入力してください。" },
    });

    // Then
    expect(next.error).toBeNull();
    expect(next.fieldErrors).toEqual({
      email: "メールアドレスを入力してください。",
    });
  });

  it("submit_invalidはcaptchaエラーも表現できる", () => {
    // Given
    const state = initialSignInState;

    // When
    const next = signinReducer(state, {
      type: "submit_invalid",
      errors: { captcha: "セキュリティチェックが完了していません。" },
    });

    // Then
    expect(next.error).toBeNull();
    expect(next.fieldErrors).toEqual({
      captcha: "セキュリティチェックが完了していません。",
    });
  });

  it("submit_startedはerror・fieldErrorsをクリアする（前回の失敗を引きずらない）", () => {
    // Given
    const state = stateWith({
      error: "前回のエラー",
      fieldErrors: { email: "stale", captcha: "stale" },
    });

    // When
    const next = signinReducer(state, { type: "submit_started" });

    // Then
    expect(next.error).toBeNull();
    expect(next.fieldErrors).toEqual({});
  });

  it("submit_auth_errorはtranslateAuthErrorMessageの結果をerrorに設定しfieldErrorsをクリアする", () => {
    // Given
    const state = stateWith({ fieldErrors: { email: "stale" } });
    const error = makeAuthError("invalid_credentials");
    errors.translateAuthErrorMessage.mockReturnValue("翻訳済みメッセージ");

    // When
    const next = signinReducer(state, { type: "submit_auth_error", error });

    // Then
    expect(errors.translateAuthErrorMessage).toHaveBeenCalledWith(error);
    expect(next.error).toBe("翻訳済みメッセージ");
    expect(next.fieldErrors).toEqual({});
  });

  it("submit_network_errorは通信エラーメッセージを設定しfieldErrorsをクリアする", () => {
    // Given
    const state = stateWith({ fieldErrors: { email: "stale" } });

    // When
    const next = signinReducer(state, { type: "submit_network_error" });

    // Then
    expect(next.error).toBe(NETWORK_ERROR_MESSAGE);
    expect(next.fieldErrors).toEqual({});
  });
});
