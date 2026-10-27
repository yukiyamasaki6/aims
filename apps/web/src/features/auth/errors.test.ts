import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { AUTH_REQUIRED_MESSAGE, sessionFailureMessage } from "./errors";

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
