import { describe, expect, it } from "vitest";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { AuthFailureKind } from "../domain/auth-failure";

const t = translatorFor("auth");

describe("失敗の種類の文言", () => {
  it("Googleでの認証の失敗の4種は、それぞれ別の文言を返す", () => {
    // Given
    const kinds = [
      "google_cancelled",
      "google_only_address",
      "google_link_cancelled",
      "google_link_taken",
    ] as const satisfies readonly AuthFailureKind[];

    // When
    const texts = kinds.map((kind) => t(`failure.${kind}`));

    // Then
    expect(new Set(texts).size).toBe(kinds.length);
    expect(texts.every((text) => text !== "")).toBe(true);
  });

  // 文言そのものを確かめる。Googleの追加で、既存の失敗の写しが変わらないこと。
  it.each([
    [
      "offline",
      "ネットワークに接続されていません。接続を確認してから再度お試しください。",
    ],
    [
      "unreachable",
      "通信エラーが発生しました。しばらくしてから再度お試しください。",
    ],
    ["code_expired", "認証コードが正しくないか、有効期限が切れています。"],
    [
      "rate_limited",
      "リクエストの間隔が短すぎます。しばらくしてから再度お試しください。",
    ],
    ["captcha_failed", "認証に失敗しました。もう一度お試しください。"],
    [
      "email_exists",
      "このメールアドレスは使えません。別のメールアドレスを入力してください。",
    ],
    ["same_email", "現在と異なるメールアドレスを入力してください。"],
    ["other", "エラーが発生しました。しばらくしてから再度お試しください。"],
  ] as const)("既存の種類%sの文言は変わらない", (kind, expected) => {
    // Given

    // When
    const text = t(`failure.${kind}`);

    // Then
    expect(text).toBe(expected);
  });
});
