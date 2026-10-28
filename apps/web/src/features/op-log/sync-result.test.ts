import {
  AuthRetryableFetchError,
  type PostgrestError,
} from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { AUTH_REQUIRED_MESSAGE } from "@/features/auth";
import {
  authFailureResult,
  classifyFailure,
  decideSyncResult,
  rpcFailureResult,
  toSafeResult,
} from "./sync-result";

const NETWORK_FAILURE = {
  error: "通信エラー",
  cause: { type: "rpc", status: 0 },
} as const;

describe("classifyFailure", () => {
  describe("認証の状態による失敗の場合", () => {
    it("未認証は止めて残し、認証の不明は再試行する", () => {
      // Given
      // When
      const unauthenticated = classifyFailure({ type: "unauthenticated" });
      const unknown = classifyFailure({ type: "auth-unknown" });

      // Then
      expect(unauthenticated).toBe("hold");
      expect(unknown).toBe("retry");
    });
  });

  describe("送信処理の例外の場合", () => {
    it("回復し得ないと判断できないため再試行する", () => {
      // Given
      // When
      const disposition = classifyFailure({ type: "exception" });

      // Then
      expect(disposition).toBe("retry");
    });
  });

  describe("RPCの失敗の場合", () => {
    it("認可の拒否(PT403)と契約の不一致(PT422)だけを破棄する", () => {
      // Given
      // When
      const dispositions = ["PT403", "PT422"].map((code) =>
        classifyFailure({ type: "rpc", status: 400, code }),
      );

      // Then
      expect(dispositions).toEqual(["discard", "discard"]);
    });

    it("それ以外は、HTTPステータスやSQLSTATEによらず再試行する", () => {
      // Given
      // When
      const causes = [
        ...[408, 429, 400, 401, 403, 404, 409, 499, 500, 503, 0, undefined].map(
          (status) => ({ type: "rpc", status }) as const,
        ),
        { type: "rpc", status: 404, code: "PGRST202" } as const,
        { type: "rpc", status: 400, code: "23505" } as const,
      ];
      const dispositions = causes.map(classifyFailure);

      // Then
      expect(dispositions).toEqual(causes.map(() => "retry"));
    });
  });
});

describe("decideSyncResult", () => {
  describe("成功した場合", () => {
    it("再試行せずに確定し、操作の列から削除する", () => {
      // Given
      // When
      const decision = decideSyncResult(undefined, 0);

      // Then
      expect(decision).toEqual({ type: "settle", removeFromOutbox: true });
    });
  });

  describe("再試行する失敗の場合", () => {
    it("試行の番号に応じてバックオフした待機時間で再試行する", () => {
      // Given
      // When
      const decisions = [0, 1, 2, 3].map((attemptIndex) =>
        decideSyncResult(NETWORK_FAILURE, attemptIndex),
      );

      // Then
      expect(decisions).toEqual([
        { type: "retry", delayMs: 3000 },
        { type: "retry", delayMs: 6000 },
        { type: "retry", delayMs: 12000 },
        { type: "retry", delayMs: 24000 },
      ]);
    });

    it("上限なく再試行し、待機時間は60秒で頭打ちになる", () => {
      // Given
      // When
      const decisions = [4, 5, 20, 100].map((attemptIndex) =>
        decideSyncResult(NETWORK_FAILURE, attemptIndex),
      );

      // Then
      expect(decisions).toEqual([
        { type: "retry", delayMs: 48000 },
        { type: "retry", delayMs: 60000 },
        { type: "retry", delayMs: 60000 },
        { type: "retry", delayMs: 60000 },
      ]);
    });
  });

  describe("破棄する失敗の場合", () => {
    it("初回でも再試行せず、確定する", () => {
      // Given
      // When
      const result = {
        error: "このラウンドを編集する権限がありません。",
        cause: { type: "rpc", status: 403, code: "PT403" },
      } as const;
      const first = decideSyncResult(result, 0);
      const afterLimit = decideSyncResult(result, 5);

      // Then
      expect(first).toEqual({ type: "settle", removeFromOutbox: false });
      expect(afterLimit).toEqual({ type: "settle", removeFromOutbox: false });
    });

    it("メッセージではなく失敗の種類で判定する", () => {
      // Given
      // When
      const rejected = {
        error: AUTH_REQUIRED_MESSAGE,
        cause: { type: "rpc", status: 422, code: "PT422" },
      } as const;
      const network = {
        error: AUTH_REQUIRED_MESSAGE,
        cause: { type: "rpc", status: 0 },
      } as const;
      const rejectedDecision = decideSyncResult(rejected, 0);
      const networkDecision = decideSyncResult(network, 0);

      // Then
      expect(rejectedDecision).toEqual({
        type: "settle",
        removeFromOutbox: false,
      });
      expect(networkDecision).toEqual({ type: "retry", delayMs: 3000 });
    });
  });
});

describe("authFailureResult", () => {
  describe("未認証の場合", () => {
    it("サインインを求める未認証の失敗を返す", () => {
      // Given
      // When
      const state = { status: "unauthenticated" } as const;
      const result = authFailureResult(state);

      // Then
      expect(result).toEqual({
        error: AUTH_REQUIRED_MESSAGE,
        cause: { type: "unauthenticated" },
      });
    });
  });

  describe("不明（通信失敗）の場合", () => {
    it("通信エラーの文言と、認証の不明の種類を返し、上限なく再試行する", () => {
      // Given
      // When
      const result = authFailureResult({
        status: "unknown",
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      });

      // Then
      expect(result).toEqual({
        error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
        cause: { type: "auth-unknown" },
      });
    });

    it("不明の失敗は、初回も多数回の後も再試行する", () => {
      // Given
      const result = authFailureResult({
        status: "unknown",
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      });

      // When
      const first = decideSyncResult(result, 0);
      const exhausted = decideSyncResult(result, 10);

      // Then
      expect(first).toEqual({ type: "retry", delayMs: 3000 });
      expect(exhausted).toEqual({ type: "retry", delayMs: 60000 });
    });
  });
});

describe("rpcFailureResult", () => {
  it("エラーのメッセージと、HTTPステータス、SQLSTATEを持つRPCの失敗を返す", () => {
    // Given
    // When
    const error = { message: "forbidden", code: "42501" } as PostgrestError;
    const withStatus = rpcFailureResult(error, 403);
    const withoutStatus = rpcFailureResult(error);

    // Then
    expect(withStatus).toEqual({
      error: "forbidden",
      cause: { type: "rpc", status: 403, code: "42501" },
    });
    expect(withoutStatus).toEqual({
      error: "forbidden",
      cause: { type: "rpc", status: undefined, code: "42501" },
    });
  });
});

describe("toSafeResult", () => {
  describe("送信処理が結果を返す場合", () => {
    it("その結果をそのまま返す", async () => {
      // Given
      // When
      const success = await toSafeResult(Promise.resolve(undefined));
      const failure = await toSafeResult(Promise.resolve(NETWORK_FAILURE));

      // Then
      expect(success).toBeUndefined();
      expect(failure).toEqual(NETWORK_FAILURE);
    });
  });

  describe("送信処理が例外を投げる場合", () => {
    it("Errorであれば、そのメッセージを例外の失敗にする", async () => {
      // Given
      // When
      const result = await toSafeResult(
        Promise.reject(new Error("接続が切れました")),
      );

      // Then
      expect(result).toEqual({
        error: "接続が切れました",
        cause: { type: "exception" },
      });
    });

    it("Error以外であれば、固定のメッセージを例外の失敗にする", async () => {
      // Given
      // When
      const result = await toSafeResult(Promise.reject("boom"));

      // Then
      expect(result).toEqual({
        error: "予期しないエラーが発生しました。",
        cause: { type: "exception" },
      });
    });
  });
});
