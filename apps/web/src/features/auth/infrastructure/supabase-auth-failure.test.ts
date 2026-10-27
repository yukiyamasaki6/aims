import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { NETWORK_ERROR_MESSAGE } from "../domain/auth-failure";
import { authErrorMessage, toAuthFailure } from "./supabase-auth-failure";

const RATE_LIMIT =
  "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。";

function apiError(code: string | undefined, message = "元の文言") {
  return new AuthApiError(message, 400, code);
}

describe("toAuthFailure", () => {
  it.each([
    ["invalid_credentials", "invalid_credentials"],
    ["otp_expired", "code_expired"],
    ["over_email_send_rate_limit", "rate_limited"],
    ["over_request_rate_limit", "rate_limited"],
    ["captcha_failed", "captcha_failed"],
    ["weak_password", "weak_password"],
  ])("コード%sを失敗の種類%sにする", (code, kind) => {
    // Given

    // When
    const result = toAuthFailure(apiError(code));

    // Then
    expect(result).toEqual({ kind });
  });

  it("名前がAuthRetryableFetchErrorなら、コードがあっても届かなかった失敗にする", () => {
    // Given
    const error = new AuthRetryableFetchError("fetch failed", 0);
    Object.assign(error, { code: "invalid_credentials" });

    // When
    const result = toAuthFailure(error);

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });

  it("コードが無い通信の断も届かなかった失敗にする", () => {
    // Given
    const error = { name: "AuthRetryableFetchError", message: "fetch failed" };

    // When
    const result = toAuthFailure(error);

    // Then
    expect(result).toEqual({ kind: "unreachable" });
  });

  it.each([
    ["未知のコード", "unknown_code"],
    ["コードが無い場合", undefined],
    ["継承されたプロパティ名のコード", "toString"],
    ["継承されたconstructorのコード", "constructor"],
  ])("%sは認証サービスの文言を持つotherにする", (_name, code) => {
    // Given

    // When
    const result = toAuthFailure(apiError(code, "認証サービスの文言"));

    // Then
    expect(result).toEqual({ kind: "other", message: "認証サービスの文言" });
  });
});

describe("authErrorMessage", () => {
  it.each([
    ["通信の断", new AuthRetryableFetchError("x", 0), NETWORK_ERROR_MESSAGE],
    [
      "既知のコード",
      apiError("weak_password", "x"),
      "パスワードは8文字以上で、英字と数字の両方を含めてください。",
    ],
    [
      "レート制限のコード",
      apiError("over_request_rate_limit", "x"),
      RATE_LIMIT,
    ],
    [
      "認証情報の誤りのコード",
      apiError("invalid_credentials", "x"),
      "メールアドレスまたはパスワードが間違っています。",
    ],
    [
      "コードの期限切れのコード",
      apiError("otp_expired", "x"),
      "認証コードが正しくないか、有効期限が切れています。",
    ],
    [
      "メール送信のレート制限のコード",
      apiError("over_email_send_rate_limit", "x"),
      RATE_LIMIT,
    ],
    [
      "チェック失敗のコード",
      apiError("captcha_failed", "x"),
      "認証に失敗しました。もう一度お試しください。",
    ],
    ["未知のコード", apiError("unknown_code", "元の文言"), "元の文言"],
    ["コードが無い場合", apiError(undefined, "コードなし"), "コードなし"],
  ])("%sのエラーを利用者向けの文言にする", (_name, error, expected) => {
    // Given

    // When
    const result = authErrorMessage(error);

    // Then
    expect(result).toBe(expected);
  });
});
