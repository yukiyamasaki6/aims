import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthUnknownError,
  type Session,
} from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { classifySession } from "./session-state";

const SESSION = { user: { id: "user-1" } } as Session;

describe("classifySession", () => {
  describe("セッションがある場合", () => {
    it("エラーの有無にかかわらず、認証済みとしてセッションを返す", () => {
      // Given: エラーなし、およびエラーつきでセッションが返る結果
      const withoutError = { data: { session: SESSION }, error: null };
      const withError = {
        data: { session: SESSION },
        error: new AuthRetryableFetchError("fetch failed", 0),
      };

      // When: 分類する
      const states = [withoutError, withError].map(classifySession);

      // Then: いずれも認証済みで、セッションがそのまま返る
      expect(states).toEqual([
        { status: "authenticated", session: SESSION },
        { status: "authenticated", session: SESSION },
      ]);
    });
  });

  describe("セッションがなく、エラーが通信の失敗の場合", () => {
    it("ステータスにかかわらず、不明としてエラーを保持して返す", () => {
      // Given: 通信失敗（status 0）とサーバーの一時的な失敗（503）による結果
      const networkError = new AuthRetryableFetchError("fetch failed", 0);
      const serverError = new AuthRetryableFetchError("unavailable", 503);

      // When: 分類する
      const states = [networkError, serverError].map((error) =>
        classifySession({ data: { session: null }, error }),
      );

      // Then: いずれも不明で、元のエラーを保持する
      expect(states).toEqual([
        { status: "unknown", error: networkError },
        { status: "unknown", error: serverError },
      ]);
    });
  });

  describe("セッションがなく、通信の失敗ではない場合", () => {
    it("保存領域が空であれば、エラーがなくても未認証にする", () => {
      // Given: エラーが null の結果と、エラーが省略された結果
      // When: 分類する
      const states = [
        classifySession({ data: { session: null }, error: null }),
        classifySession({ data: { session: null } }),
      ];

      // Then: いずれも未認証になる
      expect(states).toEqual([
        { status: "unauthenticated" },
        { status: "unauthenticated" },
      ]);
    });

    it("更新の拒否などの再試行しても回復しないエラーは、未認証にする", () => {
      // Given: 更新の拒否（401、429）と、JSONではない応答によるエラー
      const errors = [
        new AuthApiError(
          "invalid refresh token",
          401,
          "refresh_token_not_found",
        ),
        new AuthApiError("rate limited", 429, "over_request_rate_limit"),
        new AuthUnknownError("bad response", new Error("not json")),
      ];

      // When: 分類する
      const states = errors.map((error) =>
        classifySession({ data: { session: null }, error }),
      );

      // Then: いずれも未認証になる
      expect(states).toEqual([
        { status: "unauthenticated" },
        { status: "unauthenticated" },
        { status: "unauthenticated" },
      ]);
    });
  });
});
