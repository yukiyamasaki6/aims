import "fake-indexeddb/auto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalIdentity } from "@/features/auth/local-identity";
import type { Database } from "@/types/supabase";
import { roundStreamId } from "../_shared/round-op-log";
import { roundOpStore } from "../_shared/round-op-store";
import { roundCreated } from "../_shared/round-op-test-helpers";
import type { SyncOperation } from "../_shared/sync-events";
import type {
  FetchedRoundDetail,
  fetchRoundDetail,
} from "./fetch-round-detail";
import { loadRoundDetail } from "./load-round-detail";
import type { RoundBaseRecord } from "./round-base";
import { applyOperations } from "./round-op-apply";
import { roundTablesFromServer, selectRoundState } from "./round-tables";
import { firstOpenEnd } from "./scorecard-input";

// 取得の待ちの上限を短くする。
vi.mock("@/features/fetch-result/fetch-content", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/fetch-result/fetch-content")
  >()),
  FALLBACK_WAIT_MS: 30,
}));

// 端末の保存はユーザーごとに持つため、サインイン済みの端末にする。
vi.mock("@/features/auth/local-identity", () => ({
  getLocalIdentity: () => "user-1",
}));

// サーバーからの取得は別のテストで確かめるため、取得関数を境界としてモックする。
const fetcher = vi.hoisted(() => ({ fetchRoundDetail: vi.fn() }));
vi.mock("./fetch-round-detail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fetch-round-detail")>()),
  ...fetcher,
}));
const fetchDetail = vi.mocked<typeof fetchRoundDetail>(
  fetcher.fetchRoundDetail,
);

// 列への入り口は境界としてモックし、読み込みは同じユーザーのIndexedDBから読む(ハブの起動を要さない)。
vi.mock("../_shared/round-op-log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_shared/round-op-log")>()),
  roundOpLog: {
    // 実物と同じく、読めないときは空にする。
    load: vi.fn(async (roundId: string) => {
      try {
        return await roundOpStore.loadStream(
          roundStreamId(roundId),
          getLocalIdentity(),
        );
      } catch {
        return { base: undefined, entries: [] };
      }
    }),
    commit: vi.fn(
      async (
        roundId: string,
        base: RoundBaseRecord | null,
        startedAt: number,
      ) => {
        // 実物と同じく、保存に失敗しても、拒否せずに空の組を返す。
        try {
          return await roundOpStore.commit(
            roundStreamId(roundId),
            getLocalIdentity(),
            base,
            startedAt,
          );
        } catch {
          return { base: undefined, entries: [] };
        }
      },
    ),
  },
}));

const supabase = {} as SupabaseClient<Database>;

const distanceA = {
  id: "d-a",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-1",
  is_marked: true,
};

const server: FetchedRoundDetail = {
  status: "in_progress",
  roundConfig: {
    name: "午前練習",
    roundDate: "2026-09-15",
    format: "outdoor",
    bowType: "recurve",
  },
  distances: [distanceA],
  shots: [],
  targetFaces: [],
  revisions: { round: 1, distances: { "d-a": 1 }, shots: {} },
  startedAt: 100,
  userId: "user-1",
};

function shotRecorded(
  eventId: string,
  scoreStr: string,
  shotId = "s-1",
): SyncOperation {
  return {
    type: "shot.recorded",
    eventId,
    shotId,
    distanceId: "d-a",
    endNumber: 1,
    scoreStr,
    scoreInt: Number(scoreStr),
  };
}

function roundUpdated(eventId: string, name: string): SyncOperation {
  return {
    type: "round.updated",
    eventId,
    roundId: "round-1",
    changes: { name, roundDate: "2026-09-20", bowType: "compound" },
  };
}

async function save(
  operation: SyncOperation,
  options: { roundId?: string; userId?: string | null } = {},
) {
  return roundOpStore.append({
    eventId: operation.eventId,
    streamId: roundStreamId(options.roundId ?? "round-1"),
    userId: options.userId === undefined ? getLocalIdentity() : options.userId,
    operation,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await roundOpStore.close();
  globalThis.indexedDB = new IDBFactory();
  fetchDetail.mockResolvedValue({ status: "ok", data: server });
});

function loaded(result: Awaited<ReturnType<typeof loadRoundDetail>>) {
  if (result.status !== "ok" || result.data.deleted) throw new Error("not ok");
  return result.data;
}

// 取得して端末へ反映した状態を、保存しておく。
async function commitBase(
  tables = roundTablesFromServer(server),
  startedAt = 50,
  revisions = server.revisions,
) {
  await roundOpStore.commit(
    roundStreamId("round-1"),
    getLocalIdentity(),
    { tables, revisions },
    startedAt,
  );
}

describe("loadRoundDetail", () => {
  it("操作の列が空なら、サーバーの状態を基準として、端末の組へ反映して返す", async () => {
    const result = await loadRoundDetail(supabase, "round-1");

    expect(loaded(result)).toMatchObject({
      base: roundTablesFromServer(server),
      group: {
        base: {
          startedAt: 100,
          base: {
            tables: roundTablesFromServer(server),
            revisions: server.revisions,
          },
        },
        entries: [],
      },
      targetFaces: [],
      pendingCreationEventId: null,
      source: "server",
    });
    expect(fetchDetail).toHaveBeenCalledWith(supabase, "round-1");
  });

  it("確定していない操作を、保存の順(seq)で返す", async () => {
    // Given: ラウンド設定の更新と同じマスの記録2回が、確定しないまま残っている
    await save(roundUpdated("e1", "更新後"));
    await save(shotRecorded("e2", "8"));
    await save(shotRecorded("e3", "10"));

    // When
    const data = loaded(await loadRoundDetail(supabase, "round-1"));

    // Then: 列にそのまま残り、重ねると最後の記録が残る
    expect(data.group.entries.map((e) => e.eventId)).toEqual([
      "e1",
      "e2",
      "e3",
    ]);
    const state = selectRoundState(
      applyOperations(
        data.base,
        data.group.entries.map((e) => ({
          operation: e.operation,
          confirmedFields: undefined,
        })),
        [],
      ),
    );
    expect(state.roundConfig.name).toBe("更新後");
    expect(state.shots).toEqual([
      expect.objectContaining({ distance_id: "d-a", score_str: "10" }),
    ]);
  });

  describe("確定済みの操作", () => {
    it("確定したrevisionを取得が持っていれば、反映済みとして組から外す", async () => {
      // Given: revision 2で確定した設定の更新を、取得(revision 2)が反映している
      await save(roundUpdated("e1", "更新後"));
      await roundOpStore.ack("e1", 2, true, null);
      fetchDetail.mockResolvedValue({
        status: "ok",
        data: { ...server, revisions: { ...server.revisions, round: 2 } },
      });

      // When
      const data = loaded(await loadRoundDetail(supabase, "round-1"));

      // Then
      expect(data.group.entries).toEqual([]);
    });

    it("確定したrevisionに取得が届いていなければ、組に残す", async () => {
      // Given: revision 3で確定した操作を、revision 2の取得はまだ反映していない
      await save(roundUpdated("e1", "更新後"));
      await roundOpStore.ack("e1", 3, true, null);
      fetchDetail.mockResolvedValue({
        status: "ok",
        data: { ...server, revisions: { ...server.revisions, round: 2 } },
      });

      // When
      const data = loaded(await loadRoundDetail(supabase, "round-1"));

      // Then
      expect(data.group.entries.map((e) => e.eventId)).toEqual(["e1"]);
    });

    it("確定済みのラウンドの削除が列にあれば、取得せずに削除済みを返す", async () => {
      await save({ type: "round.disabled", eventId: "e1", roundId: "round-1" });
      await roundOpStore.ack("e1", 5, true, null);

      const result = await loadRoundDetail(supabase, "round-1");

      expect(result).toEqual({ status: "ok", data: { deleted: true } });
      expect(fetchDetail).not.toHaveBeenCalled();
    });
  });

  describe("確定していない作成がある場合", () => {
    it("サーバーを取得せず、作成の操作を基準にして、作成のeventIdを返す", async () => {
      // Given: 作成と、その後の操作が確定しないまま残っている
      await save(roundCreated());
      await save(roundUpdated("e2", "更新後"));

      // When
      const data = loaded(await loadRoundDetail(supabase, "round-1"));

      // Then
      expect(fetchDetail).not.toHaveBeenCalled();
      expect(data.pendingCreationEventId).toBe("e-round-created");
      expect(data.base.round.config).toEqual({
        name: "",
        roundDate: "2026-09-29",
        format: "indoor",
        bowType: "compound",
      });
      expect(data.base.distances.map((d) => d.id)).toEqual(["d-1"]);
      expect(data.group.entries.map((e) => e.eventId)).toEqual([
        "e-round-created",
        "e2",
      ]);
      expect(data.targetFaces).toEqual([]);
    });

    it("作成の後にラウンドの削除が列にあれば、取得せずに削除済みを返す", async () => {
      await save(roundCreated());
      await save({ type: "round.disabled", eventId: "e2", roundId: "round-1" });

      const result = await loadRoundDetail(supabase, "round-1");

      expect(result).toEqual({ status: "ok", data: { deleted: true } });
      expect(fetchDetail).not.toHaveBeenCalled();
    });

    it("作成が確定済みなら、サーバーを取得し、作成を反映済みとして組から外す", async () => {
      // Given: 作成が確定し、取得はrevision 1以上を持つ
      await save(roundCreated());
      await roundOpStore.ack("e-round-created", 1, true, null);

      // When
      const data = loaded(await loadRoundDetail(supabase, "round-1"));

      // Then
      expect(fetchDetail).toHaveBeenCalledWith(supabase, "round-1");
      expect(data.pendingCreationEventId).toBeNull();
      expect(data.group.entries).toEqual([]);
      expect(data.base.round.config).toEqual(server.roundConfig);
    });
  });

  it("未確定のラウンドの削除が列にあれば、取得せずに削除済みを返す", async () => {
    await save({ type: "round.disabled", eventId: "e1", roundId: "round-1" });
    await save({ type: "distance.disabled", eventId: "e2", distanceId: "d-a" });

    const result = await loadRoundDetail(supabase, "round-1");

    expect(result).toEqual({ status: "ok", data: { deleted: true } });
    expect(fetchDetail).not.toHaveBeenCalled();
  });

  it("取得の間に削除が追記されたら、削除済みを返す", async () => {
    fetchDetail.mockImplementationOnce(async () => {
      await save({ type: "round.disabled", eventId: "e1", roundId: "round-1" });
      return { status: "ok", data: server };
    });

    const result = await loadRoundDetail(supabase, "round-1");

    expect(result).toEqual({ status: "ok", data: { deleted: true } });
    const stored = await roundOpStore.loadStream(
      roundStreamId("round-1"),
      "user-1",
    );
    expect(stored.base).toBeDefined();
    expect(stored.entries).toHaveLength(1);
  });

  it("別のユーザーのラウンドの削除は影響しない", async () => {
    await save(
      { type: "round.disabled", eventId: "e1", roundId: "round-1" },
      { userId: "other-user" },
    );

    const result = await loadRoundDetail(supabase, "round-1");

    expect(result).toMatchObject({ status: "ok", data: { deleted: false } });
  });

  it("重ねた後の状態から、最初に指す新しい矢が決まる", async () => {
    // Given: 1エンド2本の距離で、サーバーには1本目だけがあり、2本目が列に残っている
    const oneEnd = { ...distanceA, total_ends: 1, arrows_per_end: 2 };
    const firstArrow = {
      id: "s-1",
      distance_id: "d-a",
      end_number: 1,
      shot_number: null,
      score_str: "10",
      score_int: 10,
    };
    fetchDetail.mockResolvedValue({
      status: "ok",
      data: { ...server, distances: [oneEnd], shots: [firstArrow] },
    });
    await save(shotRecorded("e1", "9", "s-2"));

    // When
    const data = loaded(await loadRoundDetail(supabase, "round-1"));

    // Then: 全てのエンドが矢数に達し、指す新しい矢は無い(重ねる前はエンド1の新しい矢を指す)
    const state = applyOperations(
      data.base,
      data.group.entries.map((e) => ({
        operation: e.operation,
        confirmedFields: undefined,
      })),
      [],
    );
    expect(firstOpenEnd([oneEnd], [firstArrow])).toEqual({
      kind: "new",
      distanceId: "d-a",
      endNumber: 1,
    });
    expect(firstOpenEnd(state.distances, state.shots)).toBeNull();
  });

  it("別のラウンドと別のユーザーの操作は含めない", async () => {
    await save(shotRecorded("e1", "10"), { roundId: "round-2" });
    await save(shotRecorded("e2", "10"), { userId: "someone-else" });

    const result = await loadRoundDetail(supabase, "round-1");

    expect(loaded(result).group.entries).toEqual([]);
  });

  it("取得の中で確定した操作は、取得のrevisionに届かなければ組に残し、取得の後に積まれた操作も含める", async () => {
    // Given: 取得の間に、1件が確定(revision 2、取得はrevision 1)し、1件が積まれる
    await save(shotRecorded("e1", "10"));
    fetchDetail.mockImplementation(async () => {
      await roundOpStore.ack("e1", 2, true, null);
      await save(shotRecorded("e2", "9", "s-2"));
      return { status: "ok", data: server };
    });

    // When
    const data = loaded(await loadRoundDetail(supabase, "round-1"));

    // Then
    expect(data.group.entries.map((e) => e.eventId)).toEqual(["e1", "e2"]);
  });

  it.each([
    ["not-found", { status: "not-found" }],
    ["offline", { status: "offline" }],
    ["error", { status: "error", message: "読み込めませんでした。" }],
  ] as const)(
    "サーバーの取得が%sで、端末のベースが無ければ、そのまま返す",
    async (_name, failure) => {
      await save(shotRecorded("e1", "10"));
      fetchDetail.mockResolvedValue(failure);

      await expect(loadRoundDetail(supabase, "round-1")).resolves.toEqual(
        failure,
      );
    },
  );

  it("取得が例外を投げても、「読み込み中」に固定せず、errorを返す", async () => {
    fetchDetail.mockRejectedValue(new Error("boom"));

    await expect(loadRoundDetail(supabase, "round-1")).resolves.toMatchObject({
      status: "error",
    });
  });

  it("IndexedDBを読めなくても、サーバーの状態を返す", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: IndexedDBの不在を再現する
    (globalThis as any).indexedDB = undefined;

    await expect(loadRoundDetail(supabase, "round-1")).resolves.toMatchObject({
      status: "ok",
      data: { deleted: false, source: "server" },
    });
  });

  describe("端末のベースで開く場合", () => {
    it.each([
      ["offline", { status: "offline" }],
      ["error", { status: "error", message: "読み込めませんでした。" }],
    ] as const)(
      "入力中のラウンドは、サーバーの取得が%sなら、端末のベースと操作の列で開く",
      async (_name, failure) => {
        // Given: 入力中のベースと、未送信の操作を端末が持つ
        await commitBase();
        await save(shotRecorded("e1", "10"));
        fetchDetail.mockResolvedValue(failure);

        // When
        const data = loaded(await loadRoundDetail(supabase, "round-1"));

        // Then
        expect(data).toMatchObject({
          source: "local",
          base: roundTablesFromServer(server),
          pendingCreationEventId: null,
        });
        expect(data.pendingServer).toBeUndefined();
        expect(data.group.entries.map((e) => e.eventId)).toEqual(["e1"]);
      },
    );

    it("完了で未送信の操作が無いベースは、保持の対象でないため、端末のベースで開かない", async () => {
      const completed = roundTablesFromServer(server);
      completed.round.status = "completed";
      await commitBase(completed);
      fetchDetail.mockResolvedValue({ status: "offline" });

      await expect(loadRoundDetail(supabase, "round-1")).resolves.toEqual({
        status: "offline",
      });
    });

    it("完了でも、未送信の操作が残れば、端末のベースで開く", async () => {
      const completed = roundTablesFromServer(server);
      completed.round.status = "completed";
      await save(shotRecorded("e1", "10"));
      await commitBase(completed);
      fetchDetail.mockResolvedValue({ status: "offline" });

      expect(loaded(await loadRoundDetail(supabase, "round-1")).source).toBe(
        "local",
      );
    });

    it("サーバーにラウンドが無ければ、端末のベースで開かず、そのまま返す", async () => {
      await commitBase();
      fetchDetail.mockResolvedValue({ status: "not-found" });

      await expect(loadRoundDetail(supabase, "round-1")).resolves.toEqual({
        status: "not-found",
      });
    });

    it("localFallbackが偽なら、端末のベースで開かず、取得の結果をそのまま返す", async () => {
      await commitBase();
      fetchDetail.mockResolvedValue({ status: "offline" });

      await expect(
        loadRoundDetail(supabase, "round-1", { localFallback: false }),
      ).resolves.toEqual({ status: "offline" });
    });

    describe("取得が待ちの上限(FALLBACK_WAIT_MS)を超えるとき", () => {
      it("上限で端末のベースで開き、取得の完了をpendingServerで返す", async () => {
        // Given: 取得が終わらない
        await commitBase();
        let finish: (
          value: Awaited<ReturnType<typeof fetchRoundDetail>>,
        ) => void = () => {};
        fetchDetail.mockReturnValue(
          new Promise((resolve) => {
            finish = resolve;
          }),
        );

        // When
        const data = loaded(await loadRoundDetail(supabase, "round-1"));

        // Then: 端末のベースで開き、取得が済むと端末の組へ反映した結果になる
        expect(data.source).toBe("local");
        finish({ status: "ok", data: server });
        await expect(data.pendingServer).resolves.toMatchObject({
          status: "ok",
          data: { source: "server" },
        });
      });

      it("上限の前に取得が済めば、取得の結果で開く", async () => {
        await commitBase();
        fetchDetail.mockResolvedValue({ status: "ok", data: server });

        const data = loaded(await loadRoundDetail(supabase, "round-1"));

        expect(data.source).toBe("server");
      });
    });
  });
});
