import { describe, expect, it } from "vitest";
import type { RoundConfig } from "./round-config";
import { restorePendingOperations } from "./scorecard-pending";
import type { Distance, Shot } from "./scorecard-types";
import type { SyncOperation } from "./sync-events";

const roundConfig: RoundConfig = {
  name: "ラウンド",
  roundDate: "2026-09-15",
  format: "outdoor",
  bowType: "recurve",
};

const distanceA: Distance = {
  id: "d-a",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-1",
  is_marked: true,
};

const distanceB: Distance = {
  id: "d-b",
  position_key: "b",
  distance: 30,
  total_ends: 2,
  arrows_per_end: 3,
  target_face_id: "face-2",
  is_marked: false,
};

function shot(
  distanceId: string,
  end: number,
  arrow: number,
  scoreStr: string,
  scoreInt: number,
): Shot {
  return {
    distance_id: distanceId,
    end_number: end,
    arrow_number: arrow,
    score_str: scoreStr,
    score_int: scoreInt,
  };
}

function roundUpdated(eventId: string, name: string): SyncOperation {
  return {
    type: "round.updated",
    eventId,
    roundId: "round-1",
    name,
    roundDate: "2026-09-20",
    format: "field",
    bowType: "compound",
  };
}

function distanceCreated(eventId: string, id: string): SyncOperation {
  return {
    type: "distance.created",
    eventId,
    id,
    roundId: "round-1",
    positionKey: "c",
    distance: 50,
    totalEnds: 1,
    arrowsPerEnd: 2,
    targetFaceId: "face-3",
    isMarked: true,
  };
}

function distanceUpdated(eventId: string, distanceId: string): SyncOperation {
  return {
    type: "distance.updated",
    eventId,
    distanceId,
    distance: 60,
    totalEnds: 4,
    arrowsPerEnd: 5,
    targetFaceId: "face-3",
    isMarked: false,
  };
}

function shotRecorded(
  eventId: string,
  distanceId: string,
  end: number,
  arrow: number,
): SyncOperation {
  return {
    type: "shot.recorded",
    eventId,
    distanceId,
    endNumber: end,
    arrowNumber: arrow,
    shooterId: "user-1",
    scoreStr: "X",
    scoreInt: 10,
  };
}

function shotCleared(
  eventId: string,
  distanceId: string,
  end: number,
  arrow: number,
): SyncOperation {
  return {
    type: "shot.cleared",
    eventId,
    distanceId,
    endNumber: end,
    arrowNumber: arrow,
  };
}

const roundDisabled: SyncOperation = {
  type: "round.disabled",
  eventId: "e-round-disabled",
  roundId: "round-1",
};

describe("restorePendingOperations", () => {
  describe("ラウンド設定", () => {
    it("ラウンド設定の更新を反映し、複数ある場合は最後の更新にする", () => {
      // Given: ラウンド設定の更新が2つ
      const operations = [
        roundUpdated("e-1", "1回目"),
        roundUpdated("e-2", "2回目"),
      ];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: 最後の更新の内容になる
      expect(restore.roundConfig(roundConfig)).toEqual({
        name: "2回目",
        roundDate: "2026-09-20",
        format: "field",
        bowType: "compound",
      });
    });

    it("ラウンド設定の更新が無い場合、現在のラウンド設定をそのまま返す", () => {
      // Given: ラウンド設定以外の操作
      const operations = [shotRecorded("e-1", "d-a", 1, 1)];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: 現在のラウンド設定のまま
      expect(restore.roundConfig(roundConfig)).toBe(roundConfig);
    });
  });

  describe("距離", () => {
    it("距離の作成を末尾に追加する", () => {
      // Given: 距離の作成
      const operations = [distanceCreated("e-1", "d-c")];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: 作成した距離が末尾に加わる
      expect(restore.distances([distanceA])).toEqual([
        distanceA,
        {
          id: "d-c",
          position_key: "c",
          distance: 50,
          total_ends: 1,
          arrows_per_end: 2,
          target_face_id: "face-3",
          is_marked: true,
        },
      ]);
    });

    it("同じ距離の作成が重なる場合、1つだけ追加する", () => {
      // Given: 既に表示中の距離の作成と、同じ新しい距離の作成が2つ
      const operations = [
        distanceCreated("e-1", "d-a"),
        distanceCreated("e-2", "d-c"),
        distanceCreated("e-3", "d-c"),
      ];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: 既存の距離は元のまま、新しい距離は1つだけ加わる
      expect(restore.distances([distanceA]).map((d) => d.id)).toEqual([
        "d-a",
        "d-c",
      ]);
      expect(restore.distances([distanceA])[0]).toEqual(distanceA);
    });

    it("距離の更新を、指定した距離だけに反映する", () => {
      // Given: distanceAの更新
      const operations = [distanceUpdated("e-1", "d-a")];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: distanceAだけが更新後の設定になる
      expect(restore.distances([distanceA, distanceB])).toEqual([
        {
          id: "d-a",
          position_key: "a",
          distance: 60,
          total_ends: 4,
          arrows_per_end: 5,
          target_face_id: "face-3",
          is_marked: false,
        },
        distanceB,
      ]);
    });

    it("作成した距離への更新は、作成の後に反映する", () => {
      // Given: 距離の作成と、その距離の更新
      const operations = [
        distanceCreated("e-1", "d-c"),
        distanceUpdated("e-2", "d-c"),
      ];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: 作成した距離が更新後の設定になる
      expect(restore.distances([])).toEqual([
        {
          id: "d-c",
          position_key: "c",
          distance: 60,
          total_ends: 4,
          arrows_per_end: 5,
          target_face_id: "face-3",
          is_marked: false,
        },
      ]);
    });

    it("距離の無効化で、その距離と記録だけを取り除く", () => {
      // Given: distanceAの無効化
      const operations: SyncOperation[] = [
        { type: "distance.disabled", eventId: "e-1", distanceId: "d-a" },
      ];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: distanceBとその記録だけが残る
      expect(restore.distances([distanceA, distanceB])).toEqual([distanceB]);
      expect(
        restore.shots([shot("d-a", 1, 1, "10", 10), shot("d-b", 1, 1, "9", 9)]),
      ).toEqual([shot("d-b", 1, 1, "9", 9)]);
    });

    it("距離の操作が無い場合、現在の距離をそのまま返す", () => {
      // Given: 距離以外の操作
      const operations = [roundUpdated("e-1", "ラウンド")];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: 現在の距離のまま
      const distances = [distanceA];
      expect(restore.distances(distances)).toBe(distances);
    });
  });

  describe("記録", () => {
    it("記録で同じマスの記録を置き換え、他のマスの記録は残す", () => {
      // Given: distanceAの1-1への記録
      const operations = [shotRecorded("e-1", "d-a", 1, 1)];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: 1-1の元の記録が新しい記録に置き換わり、1-2と別の距離の1-1は残る
      expect(
        restore.shots([
          shot("d-a", 1, 1, "9", 9),
          shot("d-a", 1, 2, "8", 8),
          shot("d-b", 1, 1, "7", 7),
        ]),
      ).toEqual([
        shot("d-a", 1, 2, "8", 8),
        shot("d-b", 1, 1, "7", 7),
        { ...shot("d-a", 1, 1, "X", 10), shooter_id: "user-1" },
      ]);
    });

    it("クリアで同じマスの記録だけを取り除く", () => {
      // Given: distanceAの1-1のクリア
      const operations = [shotCleared("e-1", "d-a", 1, 1)];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: 1-1の記録だけが取り除かれる
      expect(
        restore.shots([shot("d-a", 1, 1, "9", 9), shot("d-a", 1, 2, "8", 8)]),
      ).toEqual([shot("d-a", 1, 2, "8", 8)]);
    });

    describe("同じマスへの記録とクリアが重なる場合", () => {
      it("記録の後にクリアすると、記録は残らない", () => {
        // Given: 同じマスへの記録とクリアの順の操作
        const operations = [
          shotRecorded("e-1", "d-a", 1, 1),
          shotCleared("e-2", "d-a", 1, 1),
        ];

        // When: 反映する
        const restore = restorePendingOperations(operations);

        // Then: 記録は残らない
        expect(restore.shots([])).toEqual([]);
      });

      it("クリアの後に記録すると、記録が残る", () => {
        // Given: 同じマスへのクリアと記録の順の操作
        const operations = [
          shotCleared("e-1", "d-a", 1, 1),
          shotRecorded("e-2", "d-a", 1, 1),
        ];

        // When: 反映する
        const restore = restorePendingOperations(operations);

        // Then: 後の記録が残る
        expect(restore.shots([shot("d-a", 1, 1, "9", 9)])).toEqual([
          { ...shot("d-a", 1, 1, "X", 10), shooter_id: "user-1" },
        ]);
      });
    });

    it("記録の操作が無い場合、現在の記録をそのまま返す", () => {
      // Given: 記録以外の操作
      const operations = [distanceUpdated("e-1", "d-a")];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: 現在の記録のまま
      const shots = [shot("d-a", 1, 1, "9", 9)];
      expect(restore.shots(shots)).toBe(shots);
    });
  });

  describe("ラウンドの削除", () => {
    it("ラウンドの削除が無い場合、一覧へ戻らない", () => {
      // Given: ラウンドの削除以外の操作
      const operations = [roundUpdated("e-1", "ラウンド")];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: 一覧へ戻らない
      expect(restore.leaveRound).toBe(false);
    });

    it("ラウンドの削除がある場合、一覧へ戻り、削除より前の操作だけを反映する", () => {
      // Given: ラウンドの削除の前後に、ラウンド設定・距離・記録の操作がある
      const operations: SyncOperation[] = [
        roundUpdated("e-1", "削除前"),
        distanceCreated("e-2", "d-c"),
        shotRecorded("e-3", "d-a", 1, 1),
        roundDisabled,
        roundUpdated("e-4", "削除後"),
        { type: "distance.disabled", eventId: "e-5", distanceId: "d-a" },
        shotCleared("e-6", "d-a", 1, 1),
      ];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: 一覧へ戻り、削除より前の操作だけが反映される
      expect(restore.leaveRound).toBe(true);
      expect(restore.roundConfig(roundConfig).name).toBe("削除前");
      expect(restore.distances([distanceA]).map((d) => d.id)).toEqual([
        "d-a",
        "d-c",
      ]);
      expect(restore.shots([])).toEqual([
        { ...shot("d-a", 1, 1, "X", 10), shooter_id: "user-1" },
      ]);
    });

    it("最初の操作がラウンドの削除の場合、一覧へ戻り、どの操作も反映しない", () => {
      // Given: ラウンドの削除の後に操作がある
      const operations = [roundDisabled, roundUpdated("e-1", "削除後")];

      // When: 反映する
      const restore = restorePendingOperations(operations);

      // Then: 一覧へ戻り、現在の状態のまま
      expect(restore.leaveRound).toBe(true);
      expect(restore.roundConfig(roundConfig)).toBe(roundConfig);
    });
  });
});
