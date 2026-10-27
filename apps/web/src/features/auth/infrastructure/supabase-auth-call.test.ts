import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { toDelivery, toFailure } from "./supabase-auth-call";

const expired = new AuthApiError("Token has expired", 403, "otp_expired");
const rateLimited = new AuthApiError(
  "rate limit",
  429,
  "over_email_send_rate_limit",
);
const weakPassword = new AuthApiError("weak", 422, "weak_password");
const connectionLost = new AuthRetryableFetchError("Failed to fetch", 0);

describe("認証サービスの呼び出しの変換", () => {
  describe("toFailure", () => {
    it("応答にエラーが無ければ、nullを返す", async () => {
      // Given
      const call = async () => ({ error: null });

      // When
      const result = await toFailure(call);

      // Then
      expect(result).toBeNull();
    });

    it.each([
      ["期限切れ", expired, { kind: "code_expired" }],
      ["弱いパスワード", weakPassword, { kind: "weak_password" }],
    ])(
      "応答のエラーが%sなら、失敗の種類に写して返す",
      async (_name, error, expected) => {
        // Given
        const call = async () => ({ error });

        // When
        const result = await toFailure(call);

        // Then
        expect(result).toEqual(expected);
      },
    );

    it("通信の断を値で返したなら、届かなかった失敗として返す", async () => {
      // Given
      const call = async () => ({ error: connectionLost });

      // When
      const result = await toFailure(call);

      // Then
      expect(result).toEqual({ kind: "unreachable" });
    });

    it("呼び出しが投げたなら、届かなかった失敗として返す", async () => {
      // Given
      const call = async () => {
        throw new Error("Failed to fetch");
      };

      // When
      const result = await toFailure(call);

      // Then
      expect(result).toEqual({ kind: "unreachable" });
    });
  });

  describe("toDelivery", () => {
    it("応答にエラーが無ければ、送信済みを返す", async () => {
      // Given
      const call = async () => ({ error: null });

      // When
      const result = await toDelivery(call);

      // Then
      expect(result).toEqual({ kind: "sent" });
    });

    it("応答のエラーがあれば、その失敗の種類で拒否として返す", async () => {
      // Given
      const call = async () => ({ error: rateLimited });

      // When
      const result = await toDelivery(call);

      // Then
      expect(result).toEqual({
        kind: "refused",
        failure: { kind: "rate_limited" },
      });
    });

    it("通信の断を値で返したなら、応答があったとして、届かなかった失敗の拒否として返す", async () => {
      // Given
      const call = async () => ({ error: connectionLost });

      // When
      const result = await toDelivery(call);

      // Then
      expect(result).toEqual({
        kind: "refused",
        failure: { kind: "unreachable" },
      });
    });

    it("呼び出しが投げたなら、応答が無かったとして、届かなかったことを返す", async () => {
      // Given
      const call = async () => {
        throw new Error("Failed to fetch");
      };

      // When
      const result = await toDelivery(call);

      // Then
      expect(result).toEqual({ kind: "unreached" });
    });
  });
});
