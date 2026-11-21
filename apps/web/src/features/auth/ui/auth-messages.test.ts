import { describe, expect, it } from "vitest";
import { translatorFor } from "@/i18n/translator-test-helpers";
import type { AuthFailureKind } from "../domain/auth-failure";

const t = translatorFor("auth");

describe("失敗の種類の文言", () => {
  // 文言そのものを確かめる。Googleの失敗の4種が、確定版の文言を返すこと。
  it.each([
    ["google_auth_failed", "Googleでの認証に失敗しました。"],
    ["google_unlink_failed", "Google認証の解除に失敗しました。"],
    ["google_link_taken", "このGoogleアカウントは既に使用されています。"],
    [
      "google_only_address",
      "このメールアドレスはGoogleアカウントで登録されています。",
    ],
  ] as const satisfies readonly [AuthFailureKind, string][])(
    "Googleの失敗の種類%sは、確定版の文言を返す",
    (kind, expected) => {
      // Given

      // When
      const text = t(`failure.${kind}`);

      // Then
      expect(text).toBe(expected);
    },
  );

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
