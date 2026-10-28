import { describe, expect, it } from "vitest";
import {
  failureMessage,
  NETWORK_ERROR_MESSAGE,
  UNREACHABLE,
  unconfirmedMessage,
} from "./auth-failure";
import { PASSWORD_MIN_LENGTH } from "./password";

const RATE_LIMIT =
  "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。";

describe("failureMessage", () => {
  it.each([
    [
      "unreachable",
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ],
    ["invalid_credentials", "メールアドレスまたはパスワードが間違っています。"],
    ["code_expired", "認証コードが正しくないか、有効期限が切れています。"],
    ["rate_limited", RATE_LIMIT],
    ["captcha_failed", "認証に失敗しました。もう一度お試しください。"],
    [
      "weak_password",
      "パスワードは8文字以上で、英字と数字の両方を含めてください。",
    ],
    ["already_registered", "このメールアドレスは既に登録されています。"],
  ] as const)("失敗の種類%sを利用者向けの文言にする", (kind, expected) => {
    // Given

    // When
    const result = failureMessage({ kind });

    // Then
    expect(result).toBe(expected);
  });

  it("otherは認証サービスの文言をそのまま返す", () => {
    // Given

    // When
    const result = failureMessage({
      kind: "other",
      message: "認証サービスの文言",
    });

    // Then
    expect(result).toBe("認証サービスの文言");
  });
});

describe("NETWORK_ERROR_MESSAGE", () => {
  it("通信エラーの文言であり、届かなかった失敗の文言と同じである", () => {
    // Given

    // When
    const result = failureMessage({ kind: "unreachable" });

    // Then
    expect(NETWORK_ERROR_MESSAGE).toBe(
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    );
    expect(result).toBe(NETWORK_ERROR_MESSAGE);
  });
});

describe("UNREACHABLE", () => {
  it("届かなかった失敗の値で、通信エラーの文言になる", () => {
    // Given

    // When
    const result = failureMessage(UNREACHABLE);

    // Then
    expect(UNREACHABLE).toEqual({ kind: "unreachable" });
    expect(result).toBe(NETWORK_ERROR_MESSAGE);
  });
});

describe("weak_password の文言", () => {
  it("パスワードの最小の長さの規則と同じ数値を示す", () => {
    // Given

    // When
    const result = failureMessage({ kind: "weak_password" });

    // Then
    expect(result).toContain(`${PASSWORD_MIN_LENGTH}文字以上`);
  });
});

describe("unconfirmedMessage", () => {
  it("未認証はサインインを促し、不明は届かなかったときと同じ文言を返す", () => {
    // Given

    // When
    const unauthenticated = unconfirmedMessage("unauthenticated");
    const unknown = unconfirmedMessage("unknown");

    // Then
    expect(unauthenticated).toBe("サインインが必要です。");
    expect(unknown).toBe(NETWORK_ERROR_MESSAGE);
    expect(unknown).toBe(failureMessage(UNREACHABLE));
  });
});
