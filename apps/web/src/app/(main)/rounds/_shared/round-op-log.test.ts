import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasRoundDeletion, roundOpLog, roundStreamId } from "./round-op-log";
import type { SyncOperation } from "./sync-events";

// 常駐のハブは別のテストで確かめるため、境界としてモックする。
const hub = vi.hoisted(() => ({
  read: vi.fn(),
  readAll: vi.fn(),
  acquire: vi.fn(),
}));
vi.mock("./round-op-hub", () => ({ roundOpHub: hub }));

beforeEach(() => {
  vi.clearAllMocks();
});

const disabled: SyncOperation = {
  type: "round.disabled",
  eventId: "e1",
  roundId: "r1",
};
const disabledDistance: SyncOperation = {
  type: "distance.disabled",
  eventId: "e2",
  distanceId: "d1",
};

describe("roundOpLog", () => {
  it("loadは、ラウンドIDを列IDへ写して読む", async () => {
    hub.read.mockResolvedValue([{ eventId: "e1" }]);

    expect(await roundOpLog.load("r1")).toEqual([{ eventId: "e1" }]);
    expect(hub.read).toHaveBeenCalledWith(roundStreamId("r1"));
  });

  it("loadは、読み込みに失敗したら空を返す", async () => {
    hub.read.mockRejectedValue(new Error("idb"));

    expect(await roundOpLog.load("r1")).toEqual([]);
  });

  it("loadAllは、列IDをラウンドIDへ写し、ラウンドの列でないものを除く", async () => {
    const operations = [{ operation: disabled, confirmedFields: undefined }];
    hub.readAll.mockResolvedValue(
      new Map([
        ["round:r1", operations],
        ["other:x", operations],
      ]),
    );

    const all = await roundOpLog.loadAll();

    expect([...all.keys()]).toEqual(["r1"]);
    expect(all.get("r1")).toBe(operations);
  });

  it("loadAllは、読み込みに失敗したら空を返す", async () => {
    hub.readAll.mockRejectedValue(new Error("idb"));

    expect((await roundOpLog.loadAll()).size).toBe(0);
  });

  it("roundは、そのラウンドの列の送信器を返す", () => {
    const sync = {};
    hub.acquire.mockReturnValue(sync);

    expect(roundOpLog.round("r1")).toBe(sync);
    expect(hub.acquire).toHaveBeenCalledWith("round:r1");
  });
});

describe("hasRoundDeletion", () => {
  it("round.disabledを含めば真", () => {
    expect(hasRoundDeletion([disabledDistance, disabled])).toBe(true);
  });

  it("含まなければ偽", () => {
    expect(hasRoundDeletion([disabledDistance])).toBe(false);
    expect(hasRoundDeletion([])).toBe(false);
  });
});
