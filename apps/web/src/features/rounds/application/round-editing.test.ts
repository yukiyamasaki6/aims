import { describe, expect, it, vi } from "vitest";
import { roundUpdated, shotRecorded } from "../domain/round-op-test-helpers";
import { statusOperation } from "../domain/round-progress";
import {
  type RoundTables,
  roundTablesFromServer,
} from "../domain/round-tables";
import type { ScoringTargetFace } from "../domain/scorecard-scoring";
import { roundStreamId, type SyncOperation } from "../domain/sync-events";
import { createFakeUniqueIds } from "./fake-unique-ids-test-helpers";
import { createRoundEditing } from "./round-editing";

const faces: ScoringTargetFace[] = [
  {
    id: "face-1",
    target_face_spots: [
      {
        target_face_rings: [
          { score_str: "10", score_int: 10, z_index: 3, color: "#000000" },
          { score_str: "9", score_int: 9, z_index: 2, color: "#000000" },
        ],
      },
    ],
  },
];

const distance = {
  id: "d-1",
  position_key: "a",
  distance: 70,
  total_ends: 12,
  arrows_per_end: 3,
  target_face_id: "face-1",
  is_marked: true,
};

function tables(status: "in_progress" | "completed"): RoundTables {
  return roundTablesFromServer({
    status,
    roundConfig: {
      name: "R",
      roundDate: "2026-09-01",
      format: "outdoor",
      bowType: "recurve",
    },
    distances: [distance],
    shots: [],
  } as never);
}

// 完了のラウンドで、空きのあるエンドへ新しい矢を記録する(表示が変わる)。
const displayChanging = shotRecorded({ shotId: "s-2" });

function setup(options: { state?: "completed" | "in_progress" } = {}) {
  const appended: { streamId: string; operation: SyncOperation }[] = [];
  const append = vi.fn(async (streamId: string, operation: SyncOperation) => {
    appended.push({ streamId, operation });
  });
  const { ids, issued } = createFakeUniqueIds();
  const current = {
    tables: tables(options.state ?? "completed"),
    targetFaces: faces,
  };
  const editing = createRoundEditing({ hub: { append }, ids });
  return { editing, appended, issued, current };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("createRoundEditing", () => {
  it("再開が要るとき、元の操作の追記の後に、そのラウンドの列へ入力中に戻す操作を続けて追記し、保存は2回になる", async () => {
    // Given
    const { editing, current, appended, issued } = setup();

    // When
    editing.append("round-1", displayChanging, current);
    await flush();

    // Then
    expect(appended).toEqual([
      { streamId: roundStreamId("round-1"), operation: displayChanging },
      {
        streamId: roundStreamId("round-1"),
        operation: statusOperation("round-1", "in_progress", issued()[0]),
      },
    ]);
  });

  it("再開が要るとき、ids.next()を1回消費する", async () => {
    // Given
    const { editing, current, issued } = setup();

    // When
    editing.append("round-1", displayChanging, current);

    // Then
    expect(issued()).toHaveLength(1);
  });

  it.each<[string, "completed" | "in_progress", SyncOperation]>([
    ["入力中のラウンドへの記録", "in_progress", displayChanging],
    [
      "完了のラウンドの設定の変更",
      "completed",
      roundUpdated({ changes: { name: "新" } }),
    ],
    [
      "完了のラウンドの変化の無い記録",
      "completed",
      shotRecorded({ shotId: "s-9", scoreStr: "7", scoreInt: 7 }),
    ],
  ])(
    "再開が要らないとき(%s)は、元の操作だけを追記し、ids.next()を消費しない",
    async (_name, state, operation) => {
      // Given
      const { editing, current, appended, issued } = setup({ state });

      // When
      editing.append("round-1", operation, current);
      await flush();

      // Then
      expect(appended.map((item) => item.operation)).toEqual([operation]);
      expect(issued()).toEqual([]);
    },
  );
});
