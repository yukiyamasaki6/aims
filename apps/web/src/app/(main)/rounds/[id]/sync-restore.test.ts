import { describe, expect, it } from "vitest";
import type { PendingSyncOperation } from "./sync-outbox";
import { orderByDependency, toRestoredInput } from "./sync-restore";

function pendingOf(key: string, dependsOnKey?: string): PendingSyncOperation {
  return {
    eventId: `event-${key}`,
    roundId: "round-1",
    key,
    dependsOnKey,
    label: key,
    operation: {
      type: "round.disabled",
      eventId: `event-${key}`,
      roundId: "round-1",
    },
    userId: null,
  };
}

function keysOf(operations: PendingSyncOperation[]): string[] {
  return operations.map((pending) => pending.key);
}

describe("orderByDependency", () => {
  describe("依存先を持たない操作だけの場合", () => {
    it("保存順のまま並べる", () => {
      // Given: 依存先を持たない3つの操作
      const operations = [pendingOf("a"), pendingOf("b"), pendingOf("c")];

      // When: 依存関係の順に並べる
      const ordered = orderByDependency(operations);

      // Then: 保存順のまま
      expect(keysOf(ordered)).toEqual(["a", "b", "c"]);
    });
  });

  describe("依存先より先に保存された操作がある場合", () => {
    it("依存先の後に並べ、それ以外は保存順を保つ", () => {
      // Given: 距離の作成より先に保存された、その距離へのショット
      const operations = [
        pendingOf("shot:d1:1:1", "distance:d1"),
        pendingOf("roundConfig"),
        pendingOf("distance:d1"),
      ];

      // When: 依存関係の順に並べる
      const ordered = orderByDependency(operations);

      // Then: ショットは距離の作成の後に並ぶ
      expect(keysOf(ordered)).toEqual([
        "roundConfig",
        "distance:d1",
        "shot:d1:1:1",
      ]);
    });
  });

  describe("依存先が保存されていない場合", () => {
    it("依存先を待たずに保存順で並べる", () => {
      // Given: 同期済みで保存されていない距離に依存するショット
      const operations = [
        pendingOf("shot:d1:1:1", "distance:d1"),
        pendingOf("roundConfig"),
      ];

      // When: 依存関係の順に並べる
      const ordered = orderByDependency(operations);

      // Then: 保存順のまま
      expect(keysOf(ordered)).toEqual(["shot:d1:1:1", "roundConfig"]);
    });
  });

  describe("依存関係が循環している場合", () => {
    it("並べられる操作を先に並べ、循環した操作は残りの先頭から取り出して全て並べる", () => {
      // Given: 互いに依存し合う2つの操作と、依存先を持たない操作
      const operations = [
        pendingOf("a", "b"),
        pendingOf("b", "a"),
        pendingOf("c"),
      ];

      // When: 依存関係の順に並べる
      const ordered = orderByDependency(operations);

      // Then: 依存先を持たない操作の後に、循環した操作を保存順で並べる
      expect(keysOf(ordered)).toEqual(["c", "a", "b"]);
    });
  });
});

describe("toRestoredInput", () => {
  describe("ショットの記録の場合", () => {
    it("記録としてショットのバッチに積む入力にする", () => {
      // Given: 代理修正のショットの記録
      const pending: PendingSyncOperation = {
        eventId: "e1",
        roundId: "round-1",
        key: "shot:d1:1:2",
        dependsOnKey: "distance:d1",
        label: "距離1 1エンド2本目",
        operation: {
          type: "shot.recorded",
          eventId: "e1",
          distanceId: "d1",
          endNumber: 1,
          arrowNumber: 2,
          scoreStr: "9",
          scoreInt: 9,
          shooterId: "shooter-1",
        },
        userId: null,
      };

      // When: 積み直す入力に変換する
      const restored = toRestoredInput(pending);

      // Then: 復元されたショットの記録になる
      expect(restored).toEqual({
        type: "shot",
        input: {
          key: "shot:d1:1:2",
          label: "距離1 1エンド2本目",
          dependsOnKey: "distance:d1",
          restored: true,
          operation: pending.operation,
          upsert: {
            shotEventId: "e1",
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 2,
            shooterId: "shooter-1",
            scoreStr: "9",
            scoreInt: 9,
          },
        },
      });
    });
  });

  describe("ショットの取り消しの場合", () => {
    it("取り消しとしてショットのバッチに積む入力にする", () => {
      // Given: ショットの取り消し
      const pending: PendingSyncOperation = {
        eventId: "e2",
        roundId: "round-1",
        key: "shot:d1:1:1",
        label: "距離1 1エンド1本目",
        operation: {
          type: "shot.cleared",
          eventId: "e2",
          distanceId: "d1",
          endNumber: 1,
          arrowNumber: 1,
        },
        userId: null,
      };

      // When: 積み直す入力に変換する
      const restored = toRestoredInput(pending);

      // Then: 復元されたショットの取り消しになる
      expect(restored).toEqual({
        type: "shot",
        input: {
          key: "shot:d1:1:1",
          label: "距離1 1エンド1本目",
          dependsOnKey: undefined,
          restored: true,
          operation: pending.operation,
          clear: {
            shotEventId: "e2",
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 1,
          },
        },
      });
    });
  });

  describe("ショット以外の操作の場合", () => {
    it("通常の操作として積む入力にする", () => {
      // Given: 距離の設定変更
      const pending: PendingSyncOperation = {
        eventId: "e3",
        roundId: "round-1",
        key: "distance:d1",
        label: "距離1",
        operation: {
          type: "distance.updated",
          eventId: "e3",
          distanceId: "d1",
          distance: 70,
          totalEnds: 6,
          arrowsPerEnd: 6,
          targetFaceId: "face-1",
          isMarked: false,
        },
        userId: null,
      };

      // When: 積み直す入力に変換する
      const restored = toRestoredInput(pending);

      // Then: 復元された通常の操作になる
      expect(restored).toEqual({
        type: "operation",
        input: {
          key: "distance:d1",
          label: "距離1",
          dependsOnKey: undefined,
          restored: true,
          operation: pending.operation,
        },
      });
    });
  });
});
