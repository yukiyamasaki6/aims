import { describe, expect, it } from "vitest";
import {
  batchLimitOf,
  conflicts,
  laneOf,
  SERIAL_LANE,
} from "./round-op-conflicts";
import {
  distanceCreated,
  distanceDisabled,
  distanceUpdated,
  roundDisabled,
  roundUpdated,
  shotCleared,
  shotRecorded,
} from "./round-op-test-helpers";

describe("conflicts", () => {
  it.each([
    ["ラウンド設定どうし", roundUpdated(), roundUpdated()],
    ["ラウンド設定の後の距離の作成", roundUpdated(), distanceCreated()],
    ["ラウンド設定の後の距離の更新", roundUpdated(), distanceUpdated()],
    ["距離の更新の後のラウンド設定", distanceUpdated(), roundUpdated()],
    ["距離の作成の後のラウンド設定", distanceCreated(), roundUpdated()],
    ["ラウンドの削除の後の矢", roundDisabled(), shotRecorded()],
    ["ラウンドの削除の後の距離", roundDisabled(), distanceCreated()],
    ["距離の作成の後の同じ距離の更新", distanceCreated(), distanceUpdated()],
    ["距離の作成の後の同じ距離の矢", distanceCreated(), shotRecorded()],
    ["距離の更新の後の同じ距離の矢", distanceUpdated(), shotRecorded()],
    ["矢の後の同じ距離の削除", shotRecorded(), distanceDisabled()],
    ["距離の削除の後の同じ距離の矢", distanceDisabled(), shotCleared()],
    ["同じマスの記録どうし", shotRecorded(), shotRecorded()],
    ["同じマスの記録の後の取り消し", shotRecorded(), shotCleared()],
    ["同じマスの取り消しの後の記録", shotCleared(), shotRecorded()],
  ])("衝突する: %s", (_name, previous, next) => {
    expect(conflicts(previous, next)).toBe(true);
  });

  it.each([
    ["ラウンド設定の後の矢", roundUpdated(), shotRecorded()],
    ["矢の後のラウンド設定", shotRecorded(), roundUpdated()],
    [
      "別の距離の作成の後の更新",
      distanceCreated(),
      distanceUpdated({ distanceId: "d-2" }),
    ],
    [
      "距離の作成の後の別の距離の矢",
      distanceCreated(),
      shotRecorded({ distanceId: "d-2" }),
    ],
    ["別のマスの記録", shotRecorded(), shotRecorded({ arrowNumber: 2 })],
    ["別のエンドの記録", shotRecorded(), shotRecorded({ endNumber: 2 })],
    ["別の距離の同じマス", shotRecorded(), shotRecorded({ distanceId: "d-2" })],
    [
      "同じ距離の別のマスの取り消し",
      shotRecorded(),
      shotCleared({ arrowNumber: 2 }),
    ],
    ["別の距離の更新の後の削除", distanceUpdated(), distanceDisabled("d-2")],
  ])("衝突しない: %s", (_name, previous, next) => {
    expect(conflicts(previous, next)).toBe(false);
  });
});

describe("laneOf", () => {
  it("矢の記録と取り消しは、距離ごとに別のlane、それ以外は直列のlaneにする", () => {
    expect(laneOf(shotRecorded({ distanceId: "d-1" }))).toBe("record:d-1");
    expect(laneOf(shotCleared({ distanceId: "d-1" }))).toBe("clear:d-1");
    expect(laneOf(shotRecorded({ distanceId: "d-2" }))).toBe("record:d-2");
    expect(laneOf(roundUpdated())).toBe(SERIAL_LANE);
    expect(laneOf(distanceCreated())).toBe(SERIAL_LANE);
  });
});

describe("batchLimitOf", () => {
  it("矢のlaneは100件、直列のlaneは1件にする", () => {
    expect(batchLimitOf("record:d-1")).toBe(100);
    expect(batchLimitOf("clear:d-1")).toBe(100);
    expect(batchLimitOf(SERIAL_LANE)).toBe(1);
  });
});
