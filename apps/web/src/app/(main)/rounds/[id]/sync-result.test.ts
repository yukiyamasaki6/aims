import { describe, expect, it } from "vitest";
import {
  AUTH_REQUIRED_MESSAGE,
  decideSyncResult,
  toSafeResult,
} from "./sync-result";

describe("decideSyncResult", () => {
  describe("成功した場合", () => {
    it("再試行せずに確定し、outboxから削除し、恒久的な失敗を通知しない", () => {
      // Given: 失敗のない送信結果
      // When: 判定する
      const decision = decideSyncResult(undefined, 0);

      // Then: outboxから削除する確定になる
      expect(decision).toEqual({
        type: "settle",
        removeFromOutbox: true,
        notifyPermanentFailure: false,
      });
    });
  });

  describe("再試行できる失敗の場合", () => {
    it("試行の番号に応じてバックオフした待機時間で再試行する", () => {
      // Given: 通信エラーによる失敗
      const result = { error: "通信エラー" };

      // When: 初回から3回目の再試行までの各試行で判定する
      const decisions = [0, 1, 2, 3].map((attemptIndex) =>
        decideSyncResult(result, attemptIndex),
      );

      // Then: 3秒から倍々に延ばした待機時間で再試行する
      expect(decisions).toEqual([
        { type: "retry", delayMs: 3000 },
        { type: "retry", delayMs: 6000 },
        { type: "retry", delayMs: 12000 },
        { type: "retry", delayMs: 24000 },
      ]);
    });

    it("再試行の上限に達すると、再送できるようoutboxに残して確定する", () => {
      // Given: 通信エラーによる失敗
      const result = { error: "通信エラー" };

      // When: 上限の直前・上限・上限の後の試行で判定する
      const beforeLimit = decideSyncResult(result, 3);
      const atLimit = decideSyncResult(result, 4);
      const afterLimit = decideSyncResult(result, 5);

      // Then: 上限の直前までは再試行し、上限以降はoutboxに残して確定する
      expect(beforeLimit).toEqual({ type: "retry", delayMs: 24000 });
      expect(atLimit).toEqual({
        type: "settle",
        removeFromOutbox: false,
        notifyPermanentFailure: false,
      });
      expect(afterLimit).toEqual({
        type: "settle",
        removeFromOutbox: false,
        notifyPermanentFailure: false,
      });
    });
  });

  describe("恒久的な失敗の場合", () => {
    it("初回でも再試行せずに確定し、outboxから削除し、恒久的な失敗を通知する", () => {
      // Given: 権限がなく恒久的に失敗した結果
      const result = {
        error: "このラウンドを編集する権限がありません。",
        permanent: true,
      };

      // When: 初回の試行で判定する
      const decision = decideSyncResult(result, 0);

      // Then: 再送しても解消しないためoutboxから削除し、通知する
      expect(decision).toEqual({
        type: "settle",
        removeFromOutbox: true,
        notifyPermanentFailure: true,
      });
    });
  });

  describe("サインインが必要な失敗の場合", () => {
    it("恒久的な失敗であれば、outboxから削除するが通知しない", () => {
      // Given: 恒久的な失敗として返された、サインインが必要な失敗
      const result = { error: AUTH_REQUIRED_MESSAGE, permanent: true };

      // When: 初回の試行で判定する
      const decision = decideSyncResult(result, 0);

      // Then: 再試行せずoutboxから削除し、恒久的な失敗としては通知しない
      expect(decision).toEqual({
        type: "settle",
        removeFromOutbox: true,
        notifyPermanentFailure: false,
      });
    });

    it("恒久的な失敗でなくても再試行せず、outboxに残して確定する", () => {
      // Given: 恒久的な指定のない、サインインが必要な失敗
      const result = { error: AUTH_REQUIRED_MESSAGE };

      // When: 初回の試行で判定する
      const decision = decideSyncResult(result, 0);

      // Then: 再試行せず、outboxに残して確定する
      expect(decision).toEqual({
        type: "settle",
        removeFromOutbox: false,
        notifyPermanentFailure: false,
      });
    });
  });
});

describe("toSafeResult", () => {
  describe("送信処理が結果を返す場合", () => {
    it("その結果をそのまま返す", async () => {
      // Given: 成功と失敗の結果を返す送信処理
      // When: 結果に変換する
      const success = await toSafeResult(Promise.resolve(undefined));
      const failure = await toSafeResult(
        Promise.resolve({ error: "通信エラー", permanent: false }),
      );

      // Then: 結果が変わらない
      expect(success).toBeUndefined();
      expect(failure).toEqual({ error: "通信エラー", permanent: false });
    });
  });

  describe("送信処理が例外を投げる場合", () => {
    it("Errorであれば、そのメッセージを失敗の結果にする", async () => {
      // Given: Errorで失敗する送信処理
      // When: 結果に変換する
      const result = await toSafeResult(
        Promise.reject(new Error("接続が切れました")),
      );

      // Then: Errorのメッセージを失敗の結果にする
      expect(result).toEqual({ error: "接続が切れました" });
    });

    it("Error以外であれば、固定のメッセージを失敗の結果にする", async () => {
      // Given: Error以外で失敗する送信処理
      // When: 結果に変換する
      const result = await toSafeResult(Promise.reject("boom"));

      // Then: 固定のメッセージを失敗の結果にする
      expect(result).toEqual({ error: "予期しないエラーが発生しました。" });
    });
  });
});
