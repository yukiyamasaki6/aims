import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/supabase";
import type { SyncOperation } from "./_shared/sync-events";
import type { RoundBaseRecord } from "./[id]/round-base";
import { roundTablesFromServer } from "./[id]/round-tables";
import type { RoundListItem } from "./fetch-rounds-list";
import { loadLocalRoundsList, loadRoundsList } from "./load-rounds-list";

// 列への入り口、一覧と一括の取得、反映、保存済みの的は別のテストで確かめるため、境界としてモックする。
// 呼び出しの順序を確かめるため、共通の配列に記録する。
const calls = vi.hoisted(() => ({ order: [] as string[] }));
const log = vi.hoisted(() => ({
  loadAll: vi.fn(),
  retainedRoundIds: vi.fn(),
}));
vi.mock("./_shared/round-op-log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_shared/round-op-log")>()),
  roundOpLog: log,
}));
const fetcher = vi.hoisted(() => ({ fetchRoundsList: vi.fn() }));
vi.mock("./fetch-rounds-list", () => fetcher);
const details = vi.hoisted(() => ({ fetchRoundDetails: vi.fn() }));
vi.mock("./[id]/fetch-round-detail", () => details);
const refresh = vi.hoisted(() => ({ commitRoundDetails: vi.fn() }));
vi.mock("./[id]/refresh-round-bases", () => refresh);
const reference = vi.hoisted(() => ({ loadReferenceSnapshot: vi.fn() }));
vi.mock("./_shared/reference-snapshot", () => reference);

const supabase = {} as SupabaseClient<Database>;
const items: RoundListItem[] = [
  { id: "r1", name: "午前", roundDate: "2026-09-15", total: 0 },
];
const fetchedDetails = {
  status: "ok",
  data: { rounds: new Map(), startedAt: 1, userId: "u1" },
};

type Entry = {
  operation: SyncOperation;
  confirmedFields: string[] | null | undefined;
};

const faces = [
  {
    id: "face-1",
    target_face_spots: [
      {
        target_face_rings: [
          { score_str: "10", score_int: 10, z_index: 2, color: "#000" },
          { score_str: "9", score_int: 9, z_index: 1, color: "#000" },
        ],
      },
    ],
  },
];

function createdOp(roundId: string, name = "作成直後"): SyncOperation {
  return {
    type: "round.created",
    eventId: `c-${roundId}`,
    roundId,
    name,
    roundDate: "2026-09-20",
    format: "outdoor",
    bowType: "recurve",
    distances: [
      {
        eventId: `cd-${roundId}`,
        id: `d-${roundId}`,
        positionKey: "a",
        distance: 70,
        isMarked: true,
        totalEnds: 6,
        arrowsPerEnd: 6,
        targetFaceId: "face-1",
      },
    ],
  };
}

function shotOp(roundId: string, arrow: number, score: number): SyncOperation {
  return {
    type: "shot.recorded",
    eventId: `s-${roundId}-${arrow}`,
    shotId: `shot-${roundId}-${arrow}`,
    distanceId: `d-${roundId}`,
    endNumber: 1,
    scoreStr: String(score),
    scoreInt: score,
  };
}

function entry(operation: SyncOperation, confirmed = false): Entry {
  return { operation, confirmedFields: confirmed ? null : undefined };
}

function disabled(roundId: string, confirmed: boolean): Entry {
  return entry(
    { type: "round.disabled", eventId: `d-${roundId}`, roundId },
    confirmed,
  );
}

function baseOf(
  status: "in_progress" | "completed",
  name = "取得済み",
): { startedAt: number; base: RoundBaseRecord } {
  return {
    startedAt: 1,
    base: {
      tables: roundTablesFromServer({
        status,
        roundConfig: {
          name,
          roundDate: "2026-09-10",
          format: "outdoor",
          bowType: "recurve",
        },
        distances: [],
        shots: [],
      }),
      revisions: { round: 1, distances: {}, shots: {} },
    },
  };
}

function snapshots(
  entries: Record<
    string,
    {
      base?: { startedAt: number; base: RoundBaseRecord | null };
      operations?: Entry[];
    }
  >,
) {
  return new Map(
    Object.entries(entries).map(([id, value]) => [
      id,
      { base: value.base, operations: value.operations ?? [] },
    ]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.order = [];
  log.loadAll.mockImplementation(async () => {
    calls.order.push("loadAll");
    return new Map();
  });
  log.retainedRoundIds.mockResolvedValue([]);
  fetcher.fetchRoundsList.mockImplementation(async () => {
    calls.order.push("fetch");
    return { status: "ok", data: items };
  });
  details.fetchRoundDetails.mockImplementation(async () => {
    calls.order.push("details");
    return fetchedDetails;
  });
  refresh.commitRoundDetails.mockImplementation(async () => {
    calls.order.push("commit");
  });
  reference.loadReferenceSnapshot.mockReturnValue(faces);
});

describe("loadRoundsList", () => {
  it("取得の前に、列を読む", async () => {
    await loadRoundsList(supabase);

    expect(calls.order.slice(0, 2)).toEqual(["loadAll", "fetch"]);
  });

  it("一覧の取得と一括の取得を行い、一括の取得に保持するラウンドのIDを渡す", async () => {
    log.retainedRoundIds.mockResolvedValue(["r9"]);

    await loadRoundsList(supabase);

    expect(fetcher.fetchRoundsList).toHaveBeenCalledWith(supabase);
    expect(details.fetchRoundDetails).toHaveBeenCalledWith(supabase, ["r9"]);
  });

  it("両方の取得が成功したら、反映の後に入力中のラウンドを求める", async () => {
    log.loadAll.mockImplementation(async () => {
      calls.order.push("loadAll");
      return snapshots(
        calls.order.includes("commit")
          ? { r2: { base: baseOf("in_progress", "反映後") } }
          : { r2: { base: baseOf("in_progress", "反映前") } },
      );
    });

    const result = await loadRoundsList(supabase);

    expect(calls.order.indexOf("commit")).toBeGreaterThan(
      calls.order.indexOf("details"),
    );
    expect(result).toMatchObject({
      status: "ok",
      data: { inProgress: [expect.objectContaining({ name: "反映後" })] },
    });
    expect(refresh.commitRoundDetails).toHaveBeenCalledWith(
      fetchedDetails.data,
      [],
    );
  });

  it("列に削除が無ければ、取得結果と入力中のラウンドを返す", async () => {
    expect(await loadRoundsList(supabase)).toEqual({
      status: "ok",
      data: {
        items,
        inProgress: [],
        deleted: new Set(),
        confirmedDeletions: [],
        startedAt: expect.any(Number),
      },
    });
  });

  it("確定済みの削除は、削除済みにし、削除の確定として返す(取得結果に含まれるかに依らない)", async () => {
    log.loadAll.mockResolvedValue(
      snapshots({
        r1: {
          operations: [entry(createdOp("r1"), true), disabled("r1", true)],
        },
      }),
    );

    const result = await loadRoundsList(supabase);

    expect(result).toMatchObject({
      status: "ok",
      data: {
        items,
        deleted: new Set(["r1"]),
        confirmedDeletions: ["r1"],
      },
    });
  });

  it("未確定の削除は、削除済みにするが、削除の確定として返さない", async () => {
    log.loadAll.mockResolvedValue(
      snapshots({
        r1: {
          operations: [entry(createdOp("r1"), true), disabled("r1", false)],
        },
      }),
    );

    const result = await loadRoundsList(supabase);

    expect(result).toMatchObject({
      status: "ok",
      data: { deleted: new Set(["r1"]), confirmedDeletions: [] },
    });
  });

  it("保存中の削除は、列に含まれないため、削除済みにしない", async () => {
    // 保存が完了した操作だけが入り口から返る。
    log.loadAll.mockResolvedValue(
      snapshots({ r1: { operations: [entry(createdOp("r1"))] } }),
    );

    const result = await loadRoundsList(supabase);

    expect(result).toMatchObject({ data: { deleted: new Set() } });
  });

  it("一覧の取得に失敗したら、一括の取得の結果に依らず、一覧の取得の結果を返す", async () => {
    fetcher.fetchRoundsList.mockResolvedValue({ status: "offline" });
    details.fetchRoundDetails.mockResolvedValue({
      status: "error",
      message: "読み込めませんでした。",
    });

    expect(await loadRoundsList(supabase)).toEqual({ status: "offline" });
    expect(refresh.commitRoundDetails).not.toHaveBeenCalled();
  });

  it("一覧の取得が成功し、一括の取得に失敗したら、一括の取得の結果を返し、反映しない", async () => {
    details.fetchRoundDetails.mockResolvedValue({
      status: "error",
      message: "読み込めませんでした。",
    });

    expect(await loadRoundsList(supabase)).toEqual({
      status: "error",
      message: "読み込めませんでした。",
    });
    expect(refresh.commitRoundDetails).not.toHaveBeenCalled();
  });
});

describe("loadLocalRoundsList", () => {
  it("入力中のラウンドだけを、名前・実施日・合計点で返す", async () => {
    log.loadAll.mockResolvedValue(
      snapshots({
        a: { base: baseOf("in_progress", "入力中") },
        b: { base: baseOf("completed", "完了") },
      }),
    );

    const local = await loadLocalRoundsList();

    expect(local.inProgress).toEqual([
      { id: "a", name: "入力中", roundDate: "2026-09-10", total: 0 },
    ]);
  });

  it("作成が未確定のラウンドと、未送信の点数を含む合計点で返す", async () => {
    log.loadAll.mockResolvedValue(
      snapshots({
        c: {
          operations: [
            entry(createdOp("c")),
            entry(shotOp("c", 1, 10)),
            entry(shotOp("c", 2, 9)),
          ],
        },
      }),
    );

    const local = await loadLocalRoundsList();

    expect(local.inProgress).toEqual([
      { id: "c", name: "作成直後", roundDate: "2026-09-20", total: 19 },
    ]);
  });

  it("端末で完了にしたラウンドは、入力中に含めない", async () => {
    log.loadAll.mockResolvedValue(
      snapshots({
        a: {
          base: baseOf("in_progress"),
          operations: [
            entry({
              type: "round.updated",
              eventId: "u1",
              roundId: "a",
              changes: { status: "completed" },
            }),
          ],
        },
      }),
    );

    expect((await loadLocalRoundsList()).inProgress).toEqual([]);
  });

  it("列に削除があるラウンドと、削除の印のラウンド、基準の無いラウンドは含めず、削除は削除済みに入れる", async () => {
    log.loadAll.mockResolvedValue(
      snapshots({
        d: { base: baseOf("in_progress"), operations: [disabled("d", false)] },
        m: { base: { startedAt: 1, base: null } },
        n: {},
      }),
    );

    const local = await loadLocalRoundsList();

    expect(local.inProgress).toEqual([]);
    expect(local.deleted).toEqual(new Set(["d"]));
  });

  it("保存済みの的で矢を判定し、的に無い点数は合計に含めない", async () => {
    log.loadAll.mockResolvedValue(
      snapshots({
        c: { operations: [entry(createdOp("c")), entry(shotOp("c", 1, 7))] },
      }),
    );

    expect((await loadLocalRoundsList()).inProgress).toEqual([
      expect.objectContaining({ id: "c", total: 0 }),
    ]);
    expect(reference.loadReferenceSnapshot).toHaveBeenCalledWith(
      "target-faces",
    );
  });

  it("保存済みの的が無ければ、的なしで判定する", async () => {
    reference.loadReferenceSnapshot.mockReturnValue(null);
    log.loadAll.mockResolvedValue(
      snapshots({
        c: { operations: [entry(createdOp("c")), entry(shotOp("c", 1, 7))] },
      }),
    );

    expect((await loadLocalRoundsList()).inProgress).toEqual([
      expect.objectContaining({ id: "c", total: 7 }),
    ]);
  });
});
