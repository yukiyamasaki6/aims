import {
  AuthApiError,
  AuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseResetPasswordAuthenticator } from "./supabase-reset-password-authenticator";

function setup() {
  const auth = {
    resetPasswordForEmail: vi.fn(),
    verifyOtp: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  };
  const getClient = vi.fn(
    () => ({ auth }) as unknown as Pick<SupabaseClient, "auth">,
  );
  return {
    authenticator: createSupabaseResetPasswordAuthenticator({ getClient }),
    auth,
    getClient,
  };
}

function unavailableClient() {
  return createSupabaseResetPasswordAuthenticator({
    getClient: () => {
      throw new Error("Missing Supabase environment variables in client.");
    },
  });
}

const expired = new AuthApiError("Token has expired", 403, "otp_expired");
const rateLimited = new AuthApiError(
  "rate limit",
  429,
  "over_email_send_rate_limit",
);
const weakPassword = new AuthApiError("weak", 422, "weak_password");
const connectionLost = new AuthRetryableFetchError("Failed to fetch", 0);

describe("Supabaseのパスワード再設定認証の実装", () => {
  describe("sendCode", () => {
    it("メールアドレスとトークンを渡し、成功を送信済みで返す", async () => {
      // Given
      const { authenticator, auth } = setup();
      auth.resetPasswordForEmail.mockResolvedValue({ error: null });

      // When
      const result = await authenticator.sendCode({
        email: "user@example.com",
        captchaToken: "captcha-token",
      });

      // Then
      expect(auth.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith(
        "user@example.com",
        { captchaToken: "captcha-token" },
      );
      expect(result).toEqual({ kind: "sent" });
    });

    it.each([
      [
        "送信の間隔の制限",
        rateLimited,
        { kind: "refused", failure: { kind: "rate_limited" } },
      ],
      [
        "通信の断",
        connectionLost,
        { kind: "refused", failure: { kind: "unreachable" } },
      ],
    ])(
      "%sを値で返したら、応答があったとして拒否で返す",
      async (_name, error, expected) => {
        // Given
        const { authenticator, auth } = setup();
        auth.resetPasswordForEmail.mockResolvedValue({ error });

        // When
        const result = await authenticator.sendCode({
          email: "user@example.com",
          captchaToken: "captcha-token",
        });

        // Then
        expect(result).toEqual(expected);
      },
    );

    it("呼び出しが投げたら、届かなかったとして返す", async () => {
      // Given
      const { authenticator, auth } = setup();
      auth.resetPasswordForEmail.mockRejectedValue(new Error("network down"));

      // When
      const result = await authenticator.sendCode({
        email: "user@example.com",
        captchaToken: "captcha-token",
      });

      // Then
      expect(result).toEqual({ kind: "unreached" });
    });

    it("接続を作れなければ、届かなかったとして返す", async () => {
      // Given
      const authenticator = unavailableClient();

      // When
      const result = await authenticator.sendCode({
        email: "user@example.com",
        captchaToken: "captcha-token",
      });

      // Then
      expect(result).toEqual({ kind: "unreached" });
    });
  });

  describe("verifyCode", () => {
    it("メールアドレスとコードを、recoveryの種類で渡し、成功をnullで返す", async () => {
      // Given
      const { authenticator, auth } = setup();
      auth.verifyOtp.mockResolvedValue({ error: null });

      // When
      const result = await authenticator.verifyCode({
        email: "user@example.com",
        code: "123456",
      });

      // Then
      expect(auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({
        email: "user@example.com",
        token: "123456",
        type: "recovery",
      });
      expect(result).toBeNull();
    });

    it("期限切れのエラーを値で返したら、コードの失敗に写して返す", async () => {
      // Given
      const { authenticator, auth } = setup();
      auth.verifyOtp.mockResolvedValue({ error: expired });

      // When
      const result = await authenticator.verifyCode({
        email: "user@example.com",
        code: "123456",
      });

      // Then
      expect(result).toEqual({ kind: "code_expired" });
    });

    it("呼び出しが投げたら、届かなかった失敗として返す", async () => {
      // Given
      const { authenticator, auth } = setup();
      auth.verifyOtp.mockRejectedValue(new Error("network down"));

      // When
      const result = await authenticator.verifyCode({
        email: "user@example.com",
        code: "123456",
      });

      // Then
      expect(result).toEqual({ kind: "unreachable" });
    });

    it("接続を作れなければ、届かなかった失敗として返す", async () => {
      // Given
      const authenticator = unavailableClient();

      // When
      const result = await authenticator.verifyCode({
        email: "user@example.com",
        code: "123456",
      });

      // Then
      expect(result).toEqual({ kind: "unreachable" });
    });
  });

  describe("setPassword", () => {
    it("パスワードを渡し、成功をnullで返す", async () => {
      // Given
      const { authenticator, auth } = setup();
      auth.updateUser.mockResolvedValue({ error: null });

      // When
      const result = await authenticator.setPassword("password1");

      // Then
      expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({
        password: "password1",
      });
      expect(result).toBeNull();
    });

    it("弱いパスワードのエラーを値で返したら、その失敗に写して返す", async () => {
      // Given
      const { authenticator, auth } = setup();
      auth.updateUser.mockResolvedValue({ error: weakPassword });

      // When
      const result = await authenticator.setPassword("password1");

      // Then
      expect(result).toEqual({ kind: "weak_password" });
    });

    it("呼び出しが投げたら、届かなかった失敗として返す", async () => {
      // Given
      const { authenticator, auth } = setup();
      auth.updateUser.mockRejectedValue(new Error("network down"));

      // When
      const result = await authenticator.setPassword("password1");

      // Then
      expect(result).toEqual({ kind: "unreachable" });
    });

    it("接続を作れなければ、届かなかった失敗として返す", async () => {
      // Given
      const authenticator = unavailableClient();

      // When
      const result = await authenticator.setPassword("password1");

      // Then
      expect(result).toEqual({ kind: "unreachable" });
    });
  });

  describe("signOutEverywhere", () => {
    it("範囲を指定せず(引数なし)にサインアウトを依頼し、成功をnullで返す", async () => {
      // Given
      const { authenticator, auth } = setup();
      auth.signOut.mockResolvedValue({ error: null });

      // When
      const result = await authenticator.signOutEverywhere();

      // Then
      expect(auth.signOut).toHaveBeenCalledExactlyOnceWith();
      expect(result).toBeNull();
    });

    it("認証サービスが値のエラーを返しても、依頼できたとしてnullで返す", async () => {
      // Given
      const { authenticator, auth } = setup();
      auth.signOut.mockResolvedValue({ error: connectionLost });

      // When
      const result = await authenticator.signOutEverywhere();

      // Then
      expect(result).toBeNull();
    });

    it("呼び出しが投げたら、届かなかった失敗として返す", async () => {
      // Given
      const { authenticator, auth } = setup();
      auth.signOut.mockRejectedValue(new Error("network down"));

      // When
      const result = await authenticator.signOutEverywhere();

      // Then
      expect(result).toEqual({ kind: "unreachable" });
    });

    it("接続を作れなければ、届かなかった失敗として返す", async () => {
      // Given
      const authenticator = unavailableClient();

      // When
      const result = await authenticator.signOutEverywhere();

      // Then
      expect(result).toEqual({ kind: "unreachable" });
    });
  });

  describe("接続の取得", () => {
    it("認証の実装を作った時点では接続を作らず、操作のたびに取得する", async () => {
      // Given
      const { authenticator, auth, getClient } = setup();
      auth.verifyOtp.mockResolvedValue({ error: null });
      auth.updateUser.mockResolvedValue({ error: null });
      auth.signOut.mockResolvedValue({ error: null });
      expect(getClient).not.toHaveBeenCalled();

      // When
      await authenticator.verifyCode({
        email: "a@example.com",
        code: "123456",
      });
      await authenticator.setPassword("password1");
      await authenticator.signOutEverywhere();

      // Then
      expect(getClient).toHaveBeenCalledTimes(3);
    });
  });
});
