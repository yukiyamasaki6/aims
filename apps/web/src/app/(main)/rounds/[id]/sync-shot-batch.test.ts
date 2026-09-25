import { describe, expect, it } from "vitest";
import type { EnqueueShotInput } from "./sync-queue-types";
import {
  distanceIdOf,
  excludeSuperseded,
  toShotBatch,
} from "./sync-shot-batch";

function recordInput(
  key: string,
  shotEventId: string,
  distanceId = "d1",
): EnqueueShotInput {
  return {
    key,
    label: key,
    upsert: {
      shotEventId,
      distanceId,
      endNumber: 1,
      arrowNumber: 1,
      scoreStr: "X",
      scoreInt: 10,
    },
  };
}

function clearInput(
  key: string,
  shotEventId: string,
  distanceId = "d1",
): EnqueueShotInput {
  return {
    key,
    label: key,
    clear: { shotEventId, distanceId, endNumber: 1, arrowNumber: 2 },
  };
}

describe("distanceIdOf", () => {
  describe("記録の入力の場合", () => {
    it("記録の距離IDを返す", () => {
      // Given: 記録の入力
      // When: 距離IDを求める
      const distanceId = distanceIdOf(recordInput("shot:d1:1:1", "e1", "d1"));

      // Then: 記録の距離IDを返す
      expect(distanceId).toBe("d1");
    });
  });

  describe("取り消しだけの入力の場合", () => {
    it("取り消しの距離IDを返す", () => {
      // Given: 取り消しだけの入力
      // When: 距離IDを求める
      const distanceId = distanceIdOf(clearInput("shot:d2:1:2", "e1", "d2"));

      // Then: 取り消しの距離IDを返す
      expect(distanceId).toBe("d2");
    });
  });

  describe("記録も取り消しも持たない入力の場合", () => {
    it("距離IDを返さない", () => {
      // Given: 送る内容を持たない入力
      // When: 距離IDを求める
      const distanceId = distanceIdOf({ key: "shot:?:1:1", label: "不明" });

      // Then: 距離IDを返さない
      expect(distanceId).toBeUndefined();
    });
  });
});

describe("excludeSuperseded", () => {
  describe("現在のバッチに同じマスの新しい値がある場合", () => {
    it("そのマスの古い値だけを除外する", () => {
      // Given: 2つのマスの送信待ちと、一方のマスに新しい値が積まれたバッチ
      const pending = [
        recordInput("shot:d1:1:1", "old-1"),
        recordInput("shot:d1:1:2", "old-2"),
      ];
      const currentBatch = new Map([
        ["shot:d1:1:1", recordInput("shot:d1:1:1", "new-1")],
      ]);

      // When: 古い値を除外する
      const items = excludeSuperseded(pending, currentBatch);

      // Then: 新しい値がないマスだけが残る
      expect(items).toEqual([
        {
          key: "shot:d1:1:2",
          label: "shot:d1:1:2",
          upsert: {
            shotEventId: "old-2",
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 1,
            scoreStr: "X",
            scoreInt: 10,
          },
        },
      ]);
    });
  });

  describe("現在のバッチがない場合", () => {
    it("全ての値を残す", () => {
      // Given: 2つのマスの送信待ち
      const pending = [
        recordInput("shot:d1:1:1", "old-1"),
        recordInput("shot:d1:1:2", "old-2"),
      ];

      // When: 古い値を除外する
      const items = excludeSuperseded(pending, undefined);

      // Then: 全て残る
      expect(items).toEqual([
        {
          key: "shot:d1:1:1",
          label: "shot:d1:1:1",
          upsert: {
            shotEventId: "old-1",
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 1,
            scoreStr: "X",
            scoreInt: 10,
          },
        },
        {
          key: "shot:d1:1:2",
          label: "shot:d1:1:2",
          upsert: {
            shotEventId: "old-2",
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 1,
            scoreStr: "X",
            scoreInt: 10,
          },
        },
      ]);
    });
  });
});

describe("toShotBatch", () => {
  describe("記録と取り消しが混在する場合", () => {
    it("記録と取り消しに振り分け、それぞれ積まれた順を保つ", () => {
      // Given: 記録と取り消しが交互に積まれた入力
      const items = [
        recordInput("shot:d1:1:1", "e1"),
        clearInput("shot:d1:1:2", "e2"),
        recordInput("shot:d1:1:3", "e3"),
        clearInput("shot:d1:1:4", "e4"),
      ];

      // When: バッチにする
      const batch = toShotBatch(items);

      // Then: 記録と取り消しに振り分けられる
      expect(batch).toEqual({
        upsert: [
          {
            shotEventId: "e1",
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 1,
            scoreStr: "X",
            scoreInt: 10,
          },
          {
            shotEventId: "e3",
            distanceId: "d1",
            endNumber: 1,
            arrowNumber: 1,
            scoreStr: "X",
            scoreInt: 10,
          },
        ],
        clear: [
          { shotEventId: "e2", distanceId: "d1", endNumber: 1, arrowNumber: 2 },
          { shotEventId: "e4", distanceId: "d1", endNumber: 1, arrowNumber: 2 },
        ],
      });
    });
  });

  describe("記録も取り消しも持たない入力がある場合", () => {
    it("その入力はバッチに含めない", () => {
      // Given: 送る内容を持たない入力
      // When: バッチにする
      const batch = toShotBatch([{ key: "shot:?:1:1", label: "不明" }]);

      // Then: 空のバッチになる
      expect(batch).toEqual({ upsert: [], clear: [] });
    });
  });
});
