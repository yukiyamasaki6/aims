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
    // Given

    // When
    const error = makeAuthError("invalid_credentials", "x");
    const message = translateAuthErrorMessage(error);

    // Then
    expect(message).toBe("メールアドレスまたはパスワードが間違っています。");
  });

  it("translates otp_expired", () => {
    // Given

    // When
    const error = makeAuthError("otp_expired", "x");
    const message = translateAuthErrorMessage(error);

    // Then
    expect(message).toBe("認証コードが正しくないか、有効期限が切れています。");
  });

  it("translates over_email_send_rate_limit", () => {
    // Given

    // When
    const error = makeAuthError("over_email_send_rate_limit", "x");
    const message = translateAuthErrorMessage(error);

    // Then
    expect(message).toBe(
      "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
    );
  });

  it("translates over_request_rate_limit", () => {
    // Given

    // When
    const error = makeAuthError("over_request_rate_limit", "x");
    const message = translateAuthErrorMessage(error);

    // Then
    expect(message).toBe(
      "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
    );
  });

  it("translates captcha_failed", () => {
    // Given

    // When
    const error = makeAuthError("captcha_failed", "x");
    const message = translateAuthErrorMessage(error);

    // Then
    expect(message).toBe("認証に失敗しました。もう一度お試しください。");
  });

  it("falls back to the original message for an unmapped code", () => {
    // Given

    // When
    const error = makeAuthError("some_unmapped_code", "original message");
    const message = translateAuthErrorMessage(error);

    // Then
    expect(message).toBe("original message");
  });

  it("falls back to the original message when code is undefined", () => {
    // Given

    // When
    const error = { message: "original message" } as AuthError;
    const message = translateAuthErrorMessage(error);

    // Then
    expect(message).toBe("original message");
  });

  it("translates AuthRetryableFetchError regardless of message content", () => {
    // Given

    // When
    const error = {
      name: "AuthRetryableFetchError",
      message: "Failed to fetch",
    } as AuthError;
    const message = translateAuthErrorMessage(error);

    // Then
    expect(message).toBe(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    );
  });
});

describe("sessionFailureMessage", () => {
  it("未認証のときは、サインインを求める文言を返す", () => {
    // Given

    // When
    const message = sessionFailureMessage({ status: "unauthenticated" });

    // Then
    expect(message).toBe(AUTH_REQUIRED_MESSAGE);
  });

  it("不明（通信失敗）のときは、通信エラーの文言を返す", () => {
    // Given

    // When
    const error = new AuthRetryableFetchError("Failed to fetch", 0);
    const message = sessionFailureMessage({ status: "unknown", error });

    // Then
    expect(message).toBe(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    );
  });
});
