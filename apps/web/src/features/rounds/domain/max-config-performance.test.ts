// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DISTANCE_LIMITS } from "./round-constants";
import { type AppliedOperation, deriveTables } from "./round-op-apply";
import {
  distanceCreated,
  roundTablesFromServer,
  shotRecorded,
} from "./round-op-test-helpers";
import { selectRoundState } from "./round-tables";
import type { ScoringTargetFace } from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";
import {
  firstOpenEnd,
  newShotPointer,
  pointerAfterScore,
} from "./shot-pointer";

// 最大構成(1距離が上限の総エンド数×上限の矢数)の処理が、実用に耐えるかを見る。
// 二乗以上の劣化を捕まえるための粗い上限で、絶対の性能の保証ではない。CIの揺れで落ちるときは、測り方でなく上限を数倍に緩める。
const LIMIT_MILLISECONDS = 100;
const REPEAT = 5;
const SHOT_COUNT = DISTANCE_LIMITS.totalEnds * DISTANCE_LIMITS.arrowsPerEnd;

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
      {
        target_face_rings: [
          ring("10", 10, 3),
          ring("9", 9, 2),
          ring("5", 5, 1),
        ],
      },
    ],
  },
];

const SCORES = [
  ["10", 10],
  ["9", 9],
  ["5", 5],
] as const;

const maxDistance: Distance = {
  id: "d-1",
  position_key: "a",
  distance: 70,
  total_ends: DISTANCE_LIMITS.totalEnds,
  arrows_per_end: DISTANCE_LIMITS.arrowsPerEnd,
  target_face_id: "face-1",
  is_marked: true,
};

// 上限の構成を全て埋める矢。エンドの先頭から矢数ずつ並べる。
function filledShots(distanceId: string): Shot[] {
  return Array.from({ length: SHOT_COUNT }, (_, index) => {
    const [scoreStr, scoreInt] = SCORES[index % SCORES.length];
    return {
      id: `s-${index}`,
      distance_id: distanceId,
      end_number: Math.floor(index / DISTANCE_LIMITS.arrowsPerEnd) + 1,
      score_str: scoreStr,
      score_int: scoreInt,
      shot_number: null,
    };
  });
}

function shotOperations() {
  return filledShots("d-1").map((shot) =>
    shotRecorded({
      eventId: `e-${shot.id}`,
      shotId: shot.id,
      distanceId: shot.distance_id,
      endNumber: shot.end_number,
      scoreStr: shot.score_str,
      scoreInt: shot.score_int,
    }),
  );
}

// 1回目は準備(JITなど)として捨て、続く複数回の中央値を返す。
function medianMilliseconds(run: () => void): number {
  run();
  const samples = Array.from({ length: REPEAT }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return samples[Math.floor(REPEAT / 2)];
}

const emptyBase = roundTablesFromServer({
  status: "in_progress",
  roundConfig: {
    name: "最大構成",
    roundDate: "2026-09-15",
    format: "outdoor",
    bowType: "recurve",
  },
  distances: [],
  shots: [],
});

describe("最大構成(総エンド数×矢数が上限)の処理時間", () => {
  describe("状態の導出", () => {
    it.each([
      ["全て未送信(オフラインで記録した)の", undefined],
      ["全てサーバーが確定済みの", null],
    ] as const)(
      "操作が%s場合でも、距離の作成と全ての矢の記録を畳み込んで全ての矢を載せ、時間が上限内になる",
      (_label, confirmedFields) => {
        // Given
        const operations: AppliedOperation[] = [
          distanceCreated({
            id: "d-1",
            totalEnds: maxDistance.total_ends,
            arrowsPerEnd: maxDistance.arrows_per_end,
            targetFaceId: "face-1",
          }),
          ...shotOperations(),
        ].map((operation) => ({ operation, confirmedFields }));
        let shotCount = 0;

        // When
        const elapsed = medianMilliseconds(() => {
          const { tables } = deriveTables(emptyBase, operations, faces);
          shotCount = selectRoundState(tables).shots.length;
        });

        // Then
        expect(shotCount).toBe(SHOT_COUNT);
        expect(elapsed).toBeLessThan(LIMIT_MILLISECONDS);
      },
    );

    it("全ての矢が埋まったベースに、矢を1本取り消す操作を重ねても、時間が上限内になり、他の矢は残る", () => {
      // Given
      const base = roundTablesFromServer({
        status: "in_progress",
        roundConfig: emptyBase.round.config,
        distances: [maxDistance],
        shots: filledShots("d-1"),
      });
      const cleared: AppliedOperation = {
        operation: {
          type: "shot.cleared",
          eventId: "e-cleared",
          shotId: "s-0",
          distanceId: "d-1",
          endNumber: 1,
        },
        confirmedFields: undefined,
      };
      let shotCount = 0;

      // When
      const elapsed = medianMilliseconds(() => {
        const { tables } = deriveTables(base, [cleared], faces);
        shotCount = selectRoundState(tables).shots.length;
      });

      // Then
      expect(shotCount).toBe(SHOT_COUNT - 1);
      expect(elapsed).toBeLessThan(LIMIT_MILLISECONDS);
    });
  });

  describe("指す矢の探索", () => {
    const nextDistance: Distance = {
      ...maxDistance,
      id: "d-2",
      position_key: "b",
      total_ends: 6,
      arrows_per_end: 6,
    };
    const distances = [maxDistance, nextDistance];

    it("最大構成の距離が全て埋まっていると、次の距離の最初のエンドを指し、時間が上限内になる", () => {
      // Given
      const shots = filledShots("d-1");
      let pointer: ReturnType<typeof firstOpenEnd> = null;

      // When
      const elapsed = medianMilliseconds(() => {
        pointer = firstOpenEnd(distances, shots);
      });

      // Then
      expect(pointer).toEqual(newShotPointer("d-2", 1));
      expect(elapsed).toBeLessThan(LIMIT_MILLISECONDS);
    });

    it("最大構成の距離の先頭のエンドから後ろが全て埋まっていると、距離をまたがず何も指さず、時間が上限内になる", () => {
      // Given
      const shots = filledShots("d-1");
      let pointer: ReturnType<typeof pointerAfterScore> = null;

      // When
      const elapsed = medianMilliseconds(() => {
        pointer = pointerAfterScore(distances, shots, newShotPointer("d-1", 1));
      });

      // Then
      expect(pointer).toBeNull();
      expect(elapsed).toBeLessThan(LIMIT_MILLISECONDS);
    });
  });
});
