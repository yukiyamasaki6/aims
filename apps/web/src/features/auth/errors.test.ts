import { type AuthError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  AUTH_REQUIRED_MESSAGE,
  sessionFailureMessage,
  translateAuthErrorMessage,
} from "./errors";

function makeAuthError(code: string, message: string): AuthError {
  return { code, message } as AuthError;
}

describe("translateAuthErrorMessage", () => {
  it("translates invalid_credentials", () => {
    expect(
      translateAuthErrorMessage(makeAuthError("invalid_credentials", "x")),
    ).toBe("メールアドレスまたはパスワードが間違っています。");
  });

  it("translates otp_expired", () => {
    expect(translateAuthErrorMessage(makeAuthError("otp_expired", "x"))).toBe(
      "認証コードが正しくないか、有効期限が切れています。",
    );
  });

  it("translates over_email_send_rate_limit", () => {
    expect(
      translateAuthErrorMessage(
        makeAuthError("over_email_send_rate_limit", "x"),
      ),
    ).toBe(
      "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
    );
  });

  it("translates over_request_rate_limit", () => {
    expect(
      translateAuthErrorMessage(makeAuthError("over_request_rate_limit", "x")),
    ).toBe(
      "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
    );
  });

  it("translates captcha_failed", () => {
    expect(
      translateAuthErrorMessage(makeAuthError("captcha_failed", "x")),
    ).toBe("認証に失敗しました。もう一度お試しください。");
  });

  it("falls back to the original message for an unmapped code", () => {
    expect(
      translateAuthErrorMessage(
        makeAuthError("some_unmapped_code", "original message"),
      ),
    ).toBe("original message");
  });

  it("falls back to the original message when code is undefined", () => {
    const error = { message: "original message" } as AuthError;
    expect(translateAuthErrorMessage(error)).toBe("original message");
  });

  it("translates AuthRetryableFetchError regardless of message content", () => {
    const error = {
      name: "AuthRetryableFetchError",
      message: "Failed to fetch",
    } as AuthError;
    expect(translateAuthErrorMessage(error)).toBe(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    );
  });
});

describe("sessionFailureMessage", () => {
  it("未認証のときは、サインインを求める文言を返す", () => {
    // Given: 未認証の状態
    // When: 失敗の文言を求める
    const message = sessionFailureMessage({ status: "unauthenticated" });

    // Then: サインインを求める文言になる
    expect(message).toBe(AUTH_REQUIRED_MESSAGE);
  });

  it("不明（通信失敗）のときは、通信エラーの文言を返す", () => {
    // Given: 通信失敗で認証状態が分からない状態
    const error = new AuthRetryableFetchError("Failed to fetch", 0);

    // When: 失敗の文言を求める
    const message = sessionFailureMessage({ status: "unknown", error });

    // Then: サインインを求めず、通信エラーの文言になる
    expect(message).toBe(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    );
  });
});
