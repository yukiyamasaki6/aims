import {
  AuthApiError,
  type AuthError,
  AuthRetryableFetchError,
  type PostgrestError,
} from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { AUTH_REQUIRED_MESSAGE } from "@/features/auth/errors";
import { classifySession } from "@/features/auth/session-state";
import {
  authFailureResult,
  classifyFailure,
  decideSyncResult,
  rpcFailureResult,
  toSafeResult,
} from "./sync-result";

function unresolvedAuthState(error: AuthError | null) {
  const state = classifySession({ data: { session: null }, error });
  if (state.status === "authenticated") {
    throw new Error("セッションなしで認証済みになった");
  }
  return state;
}

const NETWORK_FAILURE = {
  error: "通信エラー",
  cause: { type: "rpc", status: 0 },
} as const;

describe("classifyFailure", () => {
  describe("認証の状態による失敗の場合", () => {
    it("未認証は止めて残し、認証の不明は再試行する", () => {
      // Given: 未認証と、認証の不明（通信失敗）の失敗の種類
      // When: 判定する
      const unauthenticated = classifyFailure({ type: "unauthenticated" });
      const unknown = classifyFailure({ type: "auth-unknown" });

      // Then: 未認証は止めて残し、不明は再試行する
      expect(unauthenticated).toBe("hold");
      expect(unknown).toBe("retry");
    });
  });

  describe("送信処理の例外の場合", () => {
    it("回復し得ないと判断できないため再試行する", () => {
      // Given: 例外による失敗の種類
      // When: 判定する
      const disposition = classifyFailure({ type: "exception" });

      // Then: 再試行する
      expect(disposition).toBe("retry");
    });
  });

  describe("RPCの失敗の場合", () => {
    it("408・429・5xx・通信失敗（0）・未定義は再試行する", () => {
      // Given: 時間や通信の回復で解消し得るHTTPステータス
      const statuses = [408, 429, 500, 503, 0, undefined];

      // When: 判定する
      const dispositions = statuses.map((status) =>
        classifyFailure({ type: "rpc", status }),
      );

      // Then: すべて再試行する
      expect(dispositions).toEqual(statuses.map(() => "retry"));
    });

    it("408・429以外の4xxは止めて残し、4xxの前後は再試行する", () => {
      // Given: 4xxの両端の前後と、代表的な拒否のHTTPステータス
      const holdStatuses = [400, 401, 403, 404, 409, 499];
      const retryStatuses = [399, 500];

      // When: 判定する
      const holds = holdStatuses.map((status) =>
        classifyFailure({ type: "rpc", status }),
      );
      const retries = retryStatuses.map((status) =>
        classifyFailure({ type: "rpc", status }),
      );

      // Then: 4xxは止めて残し、その外側は再試行する
      expect(holds).toEqual(holdStatuses.map(() => "hold"));
      expect(retries).toEqual(retryStatuses.map(() => "retry"));
    });
  });
});

describe("decideSyncResult", () => {
  describe("成功した場合", () => {
    it("再試行せずに確定し、操作の列から削除する", () => {
      // Given: 失敗のない送信結果
      // When: 判定する
      const decision = decideSyncResult(undefined, 0);

      // Then: 操作の列から削除する確定になる
      expect(decision).toEqual({ type: "settle", removeFromOutbox: true });
    });
  });

  describe("再試行する失敗の場合", () => {
    it("試行の番号に応じてバックオフした待機時間で再試行する", () => {
      // Given: 通信失敗による失敗
      // When: 初回から3回目の再試行までの各試行で判定する
      const decisions = [0, 1, 2, 3].map((attemptIndex) =>
        decideSyncResult(NETWORK_FAILURE, attemptIndex),
      );

      // Then: 3秒から倍々に延ばした待機時間で再試行する
      expect(decisions).toEqual([
        { type: "retry", delayMs: 3000 },
        { type: "retry", delayMs: 6000 },
        { type: "retry", delayMs: 12000 },
        { type: "retry", delayMs: 24000 },
      ]);
    });

    it("再試行の上限に達すると、再送できるよう操作の列に残して確定する", () => {
      // Given: 通信失敗による失敗
      // When: 上限の直前・上限・上限の後の試行で判定する
      const beforeLimit = decideSyncResult(NETWORK_FAILURE, 3);
      const atLimit = decideSyncResult(NETWORK_FAILURE, 4);
      const afterLimit = decideSyncResult(NETWORK_FAILURE, 5);

      // Then: 上限の直前までは再試行し、上限以降は操作の列に残して確定する
      expect(beforeLimit).toEqual({ type: "retry", delayMs: 24000 });
      expect(atLimit).toEqual({ type: "settle", removeFromOutbox: false });
      expect(afterLimit).toEqual({ type: "settle", removeFromOutbox: false });
    });
  });

  describe("止めて残す失敗の場合", () => {
    it("初回でも再試行せず、操作の列に残して確定する", () => {
      // Given: サーバーが拒否した（4xx）失敗
      const result = {
        error: "このラウンドを編集する権限がありません。",
        cause: { type: "rpc", status: 400 },
      } as const;

      // When: 初回と上限の後の試行で判定する
      const first = decideSyncResult(result, 0);
      const afterLimit = decideSyncResult(result, 5);

      // Then: いずれも操作の列に残して確定する
      expect(first).toEqual({ type: "settle", removeFromOutbox: false });
      expect(afterLimit).toEqual({ type: "settle", removeFromOutbox: false });
    });

    it("メッセージではなく失敗の種類で判定する", () => {
      // Given: サインインが必要な文言を持つ、4xxの失敗と、通信失敗
      const rejected = {
        error: AUTH_REQUIRED_MESSAGE,
        cause: { type: "rpc", status: 400 },
      } as const;
      const network = {
        error: AUTH_REQUIRED_MESSAGE,
        cause: { type: "rpc", status: 0 },
      } as const;

      // When: 初回の試行で判定する
      const rejectedDecision = decideSyncResult(rejected, 0);
      const networkDecision = decideSyncResult(network, 0);

      // Then: 失敗の種類に従い、4xxは残し、通信失敗は再試行する
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
    it("セッションがなければ、サインインを求める未認証の失敗を返す", () => {
      // Given: セッションがなく、未認証と分類された状態
      const state = unresolvedAuthState(null);

      // When: 失敗の結果に変換する
      const result = authFailureResult(state);

      // Then: サインインを求める文言と、未認証の種類になる
      expect(result).toEqual({
        error: AUTH_REQUIRED_MESSAGE,
        cause: { type: "unauthenticated" },
      });
    });

    it("更新の拒否による未認証も、同じ失敗にする", () => {
      // Given: 更新が拒否され、未認証と分類された状態
      const state = unresolvedAuthState(
        new AuthApiError("denied", 401, "refresh_token_not_found"),
      );

      // When: 失敗の結果に変換する
      const result = authFailureResult(state);

      // Then: サインインを求める未認証の失敗になる
      expect(result).toEqual({
        error: AUTH_REQUIRED_MESSAGE,
        cause: { type: "unauthenticated" },
      });
    });
  });

  describe("不明（通信失敗）の場合", () => {
    it("通信エラーの文言と、認証の不明の種類を返し、使い切っても操作の列に残す", () => {
      // Given: 更新が通信失敗になり、不明と分類された状態
      const state = unresolvedAuthState(
        new AuthRetryableFetchError("Failed to fetch", 0),
      );

      // When: 失敗の結果に変換し、初回と再試行を使い切った後で判定する
      const result = authFailureResult(state);
      const first = decideSyncResult(result, 0);
      const exhausted = decideSyncResult(result, 4);

      // Then: 通信エラーの文言になり、初回は再試行し、使い切ると操作の列に残す
      expect(result).toEqual({
        error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
        cause: { type: "auth-unknown" },
      });
      expect(first).toEqual({ type: "retry", delayMs: 3000 });
      expect(exhausted).toEqual({ type: "settle", removeFromOutbox: false });
    });
  });
});

describe("rpcFailureResult", () => {
  it("エラーのメッセージと、HTTPステータスを持つRPCの失敗を返す", () => {
    // Given: RPCのエラーと、HTTPステータス
    const error = { message: "forbidden", code: "42501" } as PostgrestError;

    // When: 失敗の結果に変換する
    const withStatus = rpcFailureResult(error, 403);
    const withoutStatus = rpcFailureResult(error);

    // Then: メッセージと、ステータスを持つ（取得できなければ未定義）
    expect(withStatus).toEqual({
      error: "forbidden",
      cause: { type: "rpc", status: 403 },
    });
    expect(withoutStatus).toEqual({
      error: "forbidden",
      cause: { type: "rpc", status: undefined },
    });
  });
});

describe("toSafeResult", () => {
  describe("送信処理が結果を返す場合", () => {
    it("その結果をそのまま返す", async () => {
      // Given: 成功と失敗の結果を返す送信処理
      // When: 結果に変換する
      const success = await toSafeResult(Promise.resolve(undefined));
      const failure = await toSafeResult(Promise.resolve(NETWORK_FAILURE));

      // Then: 結果が変わらない
      expect(success).toBeUndefined();
      expect(failure).toEqual(NETWORK_FAILURE);
    });
  });

  describe("送信処理が例外を投げる場合", () => {
    it("Errorであれば、そのメッセージを例外の失敗にする", async () => {
      // Given: Errorで失敗する送信処理
      // When: 結果に変換する
      const result = await toSafeResult(
        Promise.reject(new Error("接続が切れました")),
      );

      // Then: Errorのメッセージを、例外の種類の失敗にする
      expect(result).toEqual({
        error: "接続が切れました",
        cause: { type: "exception" },
      });
    });

    it("Error以外であれば、固定のメッセージを例外の失敗にする", async () => {
      // Given: Error以外で失敗する送信処理
      // When: 結果に変換する
      const result = await toSafeResult(Promise.reject("boom"));

      // Then: 固定のメッセージを、例外の種類の失敗にする
      expect(result).toEqual({
        error: "予期しないエラーが発生しました。",
        cause: { type: "exception" },
      });
    });
  });
});
