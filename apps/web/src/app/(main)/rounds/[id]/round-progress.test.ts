import { describe, expect, it } from "vitest";
import {
  distanceCreated,
  distanceDisabled,
  distanceUpdated,
  roundDisabled,
  roundUpdated,
  shotCleared,
  shotRecorded,
} from "../_shared/round-op-test-helpers";
import type { SyncOperation } from "../_shared/sync-events";
import {
  completionConfirmation,
  reopenOperation,
  statusOperation,
} from "./round-progress";
import { type RoundTables, roundTablesFromServer } from "./round-tables";
import type { ScoringTargetFace } from "./scorecard-scoring";

const ring = (scoreStr: string, scoreInt: number, zIndex: number) => ({
  score_str: scoreStr,
  score_int: scoreInt,
  z_index: zIndex,
  color: "#000000",
});
const faces: ScoringTargetFace[] = [
  {
    id: "face-1",
    target_face_spots: [
      { target_face_rings: [ring("10", 10, 3), ring("9", 9, 2)] },
    ],
  },
];

const distance = {
  id: "d-1",
  position_key: "a",
  distance: 70,
  total_ends: 1,
  arrows_per_end: 2,
  target_face_id: "face-1",
  is_marked: true,
};
const shot = (n: number, scoreStr = "10") => ({
  id: `s-${n}`,
  distance_id: "d-1",
  end_number: 1,
  shot_number: null,
  // 取得した行は、DBのNOT NULL列のため必ず射手のIDを持つ。
  shooter_id: "user-1",
  score_str: scoreStr,
  score_int: Number(scoreStr),
});

function tables(
  status: "in_progress" | "completed",
  shots: ReturnType<typeof shot>[] = [shot(1)],
  distances = [distance],
): RoundTables {
  return roundTablesFromServer({
    status,
    roundConfig: {
      name: "R",
      roundDate: "2026-09-01",
      format: "outdoor",
      bowType: "recurve",
    },
    distances,
    shots,
  } as never);
}

const reopen = (t: RoundTables, op: SyncOperation) =>
  reopenOperation("round-1", t, op, faces, "e-reopen");

describe("completionConfirmation", () => {
  it("距離が無ければ記録がない旨、矢数に達していないエンドがあれば未入力の旨、全てのエンドが矢数に達していればnullを返す", () => {
    // Given
    const full = tables("completed", [shot(1), shot(2)]);
    const partial = tables("completed", [shot(1)]);
    const none = tables("completed", [], []);

    // When / Then
    const probe = (t: RoundTables) =>
      completionConfirmation(t.distances as never, t.shots as never);
    expect(probe(full)).toBeNull();
    expect(probe(partial)).toBe("未入力のマスがあります。入力を完了しますか？");
    expect(probe(none)).toBe("記録がありません。入力を完了しますか？");
  });
});

describe("statusOperation", () => {
  it("状態だけを持つround.updatedを返す", () => {
    expect(statusOperation("round-1", "completed", "e-1")).toEqual({
      type: "round.updated",
      eventId: "e-1",
      roundId: "round-1",
      changes: { status: "completed" },
    });
  });
});

describe("reopenOperation", () => {
  describe("完了のラウンドで表示が変わる編集", () => {
    it.each<[string, SyncOperation]>([
      [
        "新しい矢の記録",
        shotRecorded({ shotId: "s-2", scoreStr: "9", scoreInt: 9 }),
      ],
      [
        "別の点数への変更",
        shotRecorded({ shotId: "s-1", scoreStr: "9", scoreInt: 9 }),
      ],
      ["記録済みの矢のクリア", shotCleared({ shotId: "s-1" })],
      ["距離の追加", distanceCreated({ id: "d-2", positionKey: "b" })],
      ["距離の変更", distanceUpdated({ changes: { distance: 50 } })],
      ["距離の削除", distanceDisabled("d-1")],
    ])("%sは入力中へ戻す操作を返す", (_name, op) => {
      // Given
      const t = tables("completed");

      // When
      const result = reopen(t, op);

      // Then
      expect(result).toEqual({
        type: "round.updated",
        eventId: "e-reopen",
        roundId: "round-1",
        changes: { status: "in_progress" },
      });
    });
  });

  describe("戻さない場合", () => {
    it.each<[string, SyncOperation]>([
      [
        "同じ点数の上書き",
        shotRecorded({ shotId: "s-1", scoreStr: "10", scoreInt: 10 }),
      ],
      [
        "射手だけの変更",
        shotRecorded({
          shotId: "s-1",
          scoreStr: "10",
          scoreInt: 10,
          shooterId: "user-2",
        }),
      ],
      ["存在しない矢のクリア", shotCleared({ shotId: "s-2" })],
      [
        "的にない点数の記録",
        shotRecorded({ shotId: "s-2", scoreStr: "7", scoreInt: 7 }),
      ],
      [
        "存在しない距離への記録",
        shotRecorded({ distanceId: "d-x", shotId: "s-2" }),
      ],
      [
        "削除済みでない距離の同じ値への変更",
        distanceUpdated({ changes: { distance: 70 } }),
      ],
      ["ラウンド設定の変更", roundUpdated({ changes: { name: "新" } })],
      ["ラウンドの削除", roundDisabled()],
    ])("%sは戻さない", (_name, op) => {
      expect(reopen(tables("completed"), op)).toBeNull();
    });

    it("入力中のラウンドへの編集は戻さない", () => {
      expect(
        reopen(
          tables("in_progress"),
          shotRecorded({ shotId: "s-2", scoreStr: "9", scoreInt: 9 }),
        ),
      ).toBeNull();
    });

    it("完了で、矢数に達したエンドへの新しい矢の記録は戻さない", () => {
      const full = tables("completed", [shot(1), shot(2)]);
      expect(reopen(full, shotRecorded({ shotId: "s-3" }))).toBeNull();
    });

    it("完了で、削除済みの距離への記録は戻さない", () => {
      const t = tables("completed", [], [distance]);
      const gone = {
        ...t,
        distances: t.distances.map((d) => ({ ...d, disabled: true })),
      };
      expect(reopen(gone, shotRecorded())).toBeNull();
    });
  });
});
