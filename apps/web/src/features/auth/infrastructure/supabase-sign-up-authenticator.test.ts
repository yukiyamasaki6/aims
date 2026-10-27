import {
  AuthApiError,
  AuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseSignUpAuthenticator } from "./supabase-sign-up-authenticator";

function setup() {
  const auth = {
    signInWithOtp: vi.fn(),
    verifyOtp: vi.fn(),
    updateUser: vi.fn(),
  };
  const getClient = vi.fn(
    () => ({ auth }) as unknown as Pick<SupabaseClient, "auth">,
  );
  const isEmailRegistered = vi.fn();
  return {
    authenticator: createSupabaseSignUpAuthenticator({
      getClient,
      isEmailRegistered,
    }),
    auth,
    getClient,
    isEmailRegistered,
  };
}

const expired = new AuthApiError("Token has expired", 403, "otp_expired");
const rateLimited = new AuthApiError(
  "rate limit",
  429,
  "over_email_send_rate_limit",
);
const weakPassword = new AuthApiError("weak", 422, "weak_password");
const connectionLost = new AuthRetryableFetchError("Failed to fetch", 0);

describe("Supabaseのサインアップ認証の実装", () => {
  describe("isRegistered", () => {
    it.each([
      [true, { kind: "registered" }],
      [false, { kind: "unregistered" }],
    ])("サーバーの関数が%sを返したら、%sを返す", async (answer, expected) => {
      // Given
      const { authenticator, isEmailRegistered } = setup();
      isEmailRegistered.mockResolvedValue(answer);

      // When
      const result = await authenticator.isRegistered("user@example.com");

      // Then
      expect(isEmailRegistered).toHaveBeenCalledExactlyOnceWith(
        "user@example.com",
      );
      expect(result).toEqual(expected);
    });

    it("サーバーの関数が投げたら、届かなかったとして返す", async () => {
      // Given
      const { authenticator, isEmailRegistered } = setup();
      isEmailRegistered.mockRejectedValue(new Error("network down"));

      // When
      const result = await authenticator.isRegistered("user@example.com");

      // Then
      expect(result).toEqual({ kind: "unreached" });
    });
  });

  describe("sendCode", () => {
    it("メールアドレスとトークンを渡し、成功を送信済みで返す", async () => {
      // Given
      const { authenticator, auth } = setup();
      auth.signInWithOtp.mockResolvedValue({ error: null });

      // When
      const result = await authenticator.sendCode({
        email: "user@example.com",
        captchaToken: "captcha-token",
      });

      // Then
      expect(auth.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
        email: "user@example.com",
        options: { captchaToken: "captcha-token" },
      });
      expect(result).toEqual({ kind: "sent" });
    });

    it.each([
      ["送信の間隔の制限", rateLimited, { kind: "rate_limited" }],
      ["通信の断を値で返したエラー", connectionLost, { kind: "unreachable" }],
    ])(
      "認証サービスが%sを値で返したら、応答があった拒否として失敗の種類に写して返す",
      async (_name, error, failure) => {
        // Given
        const { authenticator, auth } = setup();
        auth.signInWithOtp.mockResolvedValue({ error });

        // When
        const result = await authenticator.sendCode({
          email: "user@example.com",
          captchaToken: "captcha-token",
        });

        // Then
        expect(result).toEqual({ kind: "refused", failure });
      },
    );

    it("呼び出しが投げたら、届かなかったとして返す", async () => {
      // Given
      const { authenticator, auth } = setup();
      auth.signInWithOtp.mockRejectedValue(new Error("network down"));

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
      const { authenticator, getClient } = setup();
      getClient.mockImplementation(() => {
        throw new Error("Missing Supabase environment variables in client.");
      });

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
    it("メールアドレスとコードを渡し、成功をnullで返す", async () => {
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
        type: "email",
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
      const { authenticator, getClient } = setup();
      getClient.mockImplementation(() => {
        throw new Error("Missing env");
      });

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
      const { authenticator, getClient } = setup();
      getClient.mockImplementation(() => {
        throw new Error("Missing env");
      });

      // When
      const result = await authenticator.setPassword("password1");

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
      expect(getClient).not.toHaveBeenCalled();

      // When
      await authenticator.verifyCode({
        email: "a@example.com",
        code: "123456",
      });
      await authenticator.setPassword("password1");

      // Then
      expect(getClient).toHaveBeenCalledTimes(2);
    });
  });
});
