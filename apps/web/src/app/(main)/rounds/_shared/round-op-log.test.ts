import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasRoundDeletion, roundOpLog, roundStreamId } from "./round-op-log";
import type { SyncOperation } from "./sync-events";

// 常駐のハブは別のテストで確かめるため、境界としてモックする。
const hub = vi.hoisted(() => ({
  read: vi.fn(),
  readAll: vi.fn(),
  readStored: vi.fn(),
  commit: vi.fn(),
  getUserId: vi.fn(),
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
    const group = { base: undefined, entries: [{ eventId: "e1" }] };
    hub.read.mockResolvedValue(group);

    expect(await roundOpLog.load("r1")).toBe(group);
    expect(hub.read).toHaveBeenCalledWith(roundStreamId("r1"));
  });

  it("loadは、読み込みに失敗したら空の組を返す", async () => {
    hub.read.mockRejectedValue(new Error("idb"));

    expect(await roundOpLog.load("r1")).toEqual({
      base: undefined,
      entries: [],
    });
  });

  it("commitは、ラウンドIDを列IDへ写して取得したベースを反映する", async () => {
    hub.commit.mockResolvedValue({ base: undefined, entries: [] });
    const record = { tables: {}, revisions: {} } as never;

    await roundOpLog.commit("r1", record, 10, "user-1");

    expect(hub.commit).toHaveBeenCalledWith("round:r1", record, 10, "user-1");
  });

  it("commitDeletedは、現在のユーザーで削除の印を反映する", async () => {
    hub.getUserId.mockReturnValue("user-1");
    hub.commit.mockResolvedValue({ base: undefined, entries: [] });

    await roundOpLog.commitDeleted("r1", 10);

    expect(hub.commit).toHaveBeenCalledWith("round:r1", null, 10, "user-1");
  });

  describe("retainedRoundIds", () => {
    const entry = (operation: SyncOperation, ackedRevision?: number) => ({
      operation,
      ackedRevision,
    });
    const created: SyncOperation = {
      type: "round.created",
      eventId: "c",
      roundId: "r",
      name: "",
      roundDate: "2026-09-29",
      format: "indoor",
      bowType: "compound",
      distances: [],
    };

    it("ベースか操作を持つ、削除されておらず作成が確定しているラウンドのIDを返す", async () => {
      hub.readStored.mockResolvedValue(
        new Map([
          [
            "round:with-base",
            { base: { startedAt: 1, base: {} }, entries: [] },
          ],
          [
            "round:with-ops",
            { base: undefined, entries: [entry(disabledDistance)] },
          ],
          ["round:marker", { base: { startedAt: 1, base: null }, entries: [] }],
          ["round:deleted", { base: undefined, entries: [entry(disabled)] }],
          ["round:pending", { base: undefined, entries: [entry(created)] }],
          ["round:created", { base: undefined, entries: [entry(created, 1)] }],
          ["other:x", { base: { startedAt: 1, base: {} }, entries: [] }],
        ]),
      );

      expect(await roundOpLog.retainedRoundIds()).toEqual([
        "with-base",
        "with-ops",
        "created",
      ]);
    });

    it("読み込みに失敗したら空を返す", async () => {
      hub.readStored.mockRejectedValue(new Error("idb"));

      expect(await roundOpLog.retainedRoundIds()).toEqual([]);
    });
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
