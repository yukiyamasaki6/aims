import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/supabase";
import type { SyncOperation } from "./_shared/sync-events";
import type { RoundListItem } from "./fetch-rounds-list";
import { loadRoundsList } from "./load-rounds-list";

// 列への入り口と一覧の取得は別のテストで確かめるため、境界としてモックする。
// 呼び出しの順序を確かめるため、共通の配列に記録する。
const calls = vi.hoisted(() => ({ order: [] as string[] }));
const log = vi.hoisted(() => ({ loadAll: vi.fn() }));
vi.mock("./_shared/round-op-log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_shared/round-op-log")>()),
  roundOpLog: { loadAll: log.loadAll },
}));
const fetcher = vi.hoisted(() => ({ fetchRoundsList: vi.fn() }));
vi.mock("./fetch-rounds-list", () => fetcher);

const supabase = {} as SupabaseClient<Database>;
const items: RoundListItem[] = [
  { id: "r1", name: "午前", roundDate: "2026-09-15", total: 0 },
];

type Entry = {
  operation: SyncOperation;
  confirmedFields: string[] | null | undefined;
};

function created(roundId: string, confirmed: boolean): Entry {
  return {
    operation: {
      type: "round.created",
      eventId: `c-${roundId}`,
      roundId,
    } as SyncOperation,
    confirmedFields: confirmed ? null : undefined,
  };
}

function disabled(roundId: string, confirmed: boolean): Entry {
  return {
    operation: { type: "round.disabled", eventId: `d-${roundId}`, roundId },
    confirmedFields: confirmed ? null : undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.order = [];
  log.loadAll.mockImplementation(async () => {
    calls.order.push("loadAll");
    return new Map();
  });
  fetcher.fetchRoundsList.mockImplementation(async () => {
    calls.order.push("fetch");
    return { status: "ok", data: items };
  });
});

describe("loadRoundsList", () => {
  it("取得の前に、列を読む", async () => {
    await loadRoundsList(supabase);

    expect(calls.order).toEqual(["loadAll", "fetch"]);
  });

  it("列に削除が無ければ、取得結果だけを返す", async () => {
    log.loadAll.mockResolvedValue(new Map([["r1", [created("r1", true)]]]));

    expect(await loadRoundsList(supabase)).toEqual({
      status: "ok",
      data: { items, deleted: new Set(), reflected: [] },
    });
  });

  it("確定済みの削除は、削除済みにし、確定済みの操作を反映済みにする(取得結果に含まれるかに依らない)", async () => {
    log.loadAll.mockResolvedValue(
      new Map([["r1", [created("r1", true), disabled("r1", true)]]]),
    );

    const result = await loadRoundsList(supabase);

    expect(result).toEqual({
      status: "ok",
      data: {
        items,
        deleted: new Set(["r1"]),
        reflected: [{ roundId: "r1", eventIds: ["c-r1", "d-r1"] }],
      },
    });
  });

  it("未確定の削除は、削除済みにするが、反映済みにしない", async () => {
    log.loadAll.mockResolvedValue(
      new Map([["r1", [created("r1", true), disabled("r1", false)]]]),
    );

    const result = await loadRoundsList(supabase);

    expect(result).toMatchObject({
      status: "ok",
      data: { deleted: new Set(["r1"]), reflected: [] },
    });
  });

  it("保存中の削除は、列に含まれないため、削除済みにしない", async () => {
    // 保存が完了した操作だけが入り口から返る。
    log.loadAll.mockResolvedValue(new Map([["r1", [created("r1", false)]]]));

    const result = await loadRoundsList(supabase);

    expect(result).toMatchObject({ data: { deleted: new Set() } });
  });

  it("取得に失敗したら、そのまま返す", async () => {
    log.loadAll.mockResolvedValue(new Map([["r1", [disabled("r1", true)]]]));
    fetcher.fetchRoundsList.mockResolvedValue({ status: "offline" });

    expect(await loadRoundsList(supabase)).toEqual({ status: "offline" });
  });
});
