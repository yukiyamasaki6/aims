import { describe, expect, it } from "vitest";
import { deriveSyncStatus } from "./sync-status";

const NONE = { offlinePending: 0, retrying: 0, sending: 0, errors: 0 };

describe("deriveSyncStatus", () => {
  describe("処理中の操作も失敗もない場合", () => {
    it("syncedになる", () => {
      // Given: 全ての件数が0
      // When: 同期状態を導出する
      const status = deriveSyncStatus(NONE);

      // Then: 同期済みになる
      expect(status).toBe("synced");
    });
  });

  describe("1つの状態だけに該当する場合", () => {
    it("件数が1件以上になると、その状態になる", () => {
      // Given: 各状態の件数が0・1・2件
      // When: 同期状態を導出する
      const statuses = (
        ["offlinePending", "retrying", "sending", "errors"] as const
      ).map((name) =>
        [0, 1, 2].map((count) => deriveSyncStatus({ ...NONE, [name]: count })),
      );

      // Then: 0件なら同期済みのままで、1件以上でその状態になる
      expect(statuses).toEqual([
        ["synced", "offline-pending", "offline-pending"],
        ["synced", "retrying", "retrying"],
        ["synced", "sending", "sending"],
        ["synced", "error", "error"],
      ]);
    });
  });

  describe("複数の状態に該当する場合", () => {
    it("offline-pending・retrying・sending・errorの順に優先する", () => {
      // Given: 優先度の高い状態から順に外していった件数
      // When: 同期状態を導出する
      const statuses = [
        { offlinePending: 1, retrying: 1, sending: 1, errors: 1 },
        { offlinePending: 0, retrying: 1, sending: 1, errors: 1 },
        { offlinePending: 0, retrying: 0, sending: 1, errors: 1 },
      ].map(deriveSyncStatus);

      // Then: 該当する中で最も優先度の高い状態になる
      expect(statuses).toEqual(["offline-pending", "retrying", "sending"]);
    });
  });
});
