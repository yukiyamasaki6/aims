import type { AuthError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { translateAuthErrorMessage } from "./errors";

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
});
