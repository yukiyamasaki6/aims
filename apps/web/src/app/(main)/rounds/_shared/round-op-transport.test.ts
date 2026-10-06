import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  distanceCreated,
  distanceDisabled,
  distanceUpdated,
  roundCreated,
  roundDisabled,
  roundUpdated,
  shotCleared,
  shotRecorded,
} from "./round-op-test-helpers";
import { sendRoundBatch as sendToUser } from "./round-op-transport";
import type { SyncOperation } from "./sync-events";

const client = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: client.getSession },
    rpc: client.rpc,
  }),
}));

// 既定では、列のユーザーはセッションのユーザーと同じ。
function sendRoundBatch(
  request: Parameters<typeof sendToUser>[0],
  expectedUserId: string | null = "user-1",
) {
  return sendToUser(request, expectedUserId);
}

function flight(...operations: SyncOperation[]) {
  return {
    lane: "lane",
    entries: operations.map((operation) => ({
      eventId: operation.eventId,
      operation,
    })),
  };
}

const resultJson = (revision: number | null = 5) => ({
  revision,
  applied: revision !== null,
  applied_fields: revision === null ? [] : null,
  rejected_fields: [],
  reason: revision === null ? "UNFIT" : null,
});

const resultOf = (revision: number | null = 5) => ({
  revision,
  applied: revision !== null,
  appliedFields: revision === null ? [] : null,
  rejectedFields: [],
  reason: revision === null ? "UNFIT" : null,
});

beforeEach(() => {
  vi.clearAllMocks();
  client.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
  });
  client.rpc.mockResolvedValue({
    data: resultJson(),
    error: null,
    status: 200,
  });
});

describe("sendRoundBatch", () => {
  it.each([
    ["update_round", roundUpdated()],
    ["disable_round", roundDisabled()],
    ["create_distance", distanceCreated()],
    ["update_distance", distanceUpdated()],
    ["disable_distance", distanceDisabled()],
  ])("単独の操作は%sで送り、判定結果を返す", async (rpc, operation) => {
    if (rpc === "disable_round") {
      client.rpc.mockResolvedValue({ data: 5, error: null, status: 200 });
    }
    const outcome = await sendRoundBatch(flight(operation));

    expect(outcome).toEqual({ ok: true, results: [resultOf()] });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc.mock.calls[0]?.[0]).toBe(rpc);
  });

  describe("ラウンドの作成", () => {
    it("create_roundへ距離を含めて送り、ラウンドIDの返りをrevision 1の適用済みとして返す", async () => {
      client.rpc.mockResolvedValue({
        data: "round-1",
        error: null,
        status: 200,
      });

      const outcome = await sendRoundBatch(flight(roundCreated()));

      expect(outcome).toEqual({
        ok: true,
        results: [
          {
            revision: 1,
            applied: true,
            appliedFields: null,
            rejectedFields: [],
            reason: null,
          },
        ],
      });
      expect(client.rpc).toHaveBeenCalledWith("create_round", {
        p_round_event_id: "e-round-created",
        p_id: "round-1",
        p_name: "",
        p_round_date: "2026-09-29",
        p_format: "indoor",
        p_bow_type: "compound",
        p_distances: [
          {
            distance_event_id: "e-created-d-1",
            id: "d-1",
            position_key: "a",
            distance: 18,
            is_marked: true,
            total_ends: 10,
            arrows_per_end: 3,
            target_face_id: "face-1",
          },
        ],
      });
    });

    it("ラウンドIDでない返りは、不正な応答として扱う", async () => {
      client.rpc.mockResolvedValue({ data: null, error: null, status: 200 });

      const outcome = await sendRoundBatch(flight(roundCreated()));

      expect(outcome.ok).toBe(false);
    });
  });

  it("矢1件の記録は、射手の指定が無ければ自分のIDでrecord_shotsへ送る", async () => {
    client.rpc.mockResolvedValue({
      data: [resultJson(7)],
      error: null,
      status: 200,
    });

    const outcome = await sendRoundBatch(flight(shotRecorded()));

    expect(outcome).toEqual({ ok: true, results: [resultOf(7)] });
    expect(client.rpc).toHaveBeenCalledWith("record_shots", {
      p_shots: [expect.objectContaining({ shooter_id: "user-1" })],
    });
  });

  it("矢の束は1回のRPCへ列の順で詰め、revisionを同じ順で返す", async () => {
    client.rpc.mockResolvedValue({
      data: [resultJson(2), resultJson(3)],
      error: null,
      status: 200,
    });

    const outcome = await sendRoundBatch(
      flight(
        shotRecorded({ eventId: "a", shooterId: "other" }),
        shotRecorded({ eventId: "b", arrowNumber: 2 }),
      ),
    );

    expect(outcome).toEqual({ ok: true, results: [resultOf(2), resultOf(3)] });
    expect(client.rpc).toHaveBeenCalledWith("record_shots", {
      p_shots: [
        expect.objectContaining({ shot_event_id: "a", shooter_id: "other" }),
        expect.objectContaining({ shot_event_id: "b", shooter_id: "user-1" }),
      ],
    });
  });

  it("取り消しの束はclear_shotsへ送る", async () => {
    client.rpc.mockResolvedValue({
      data: [resultJson(4), resultJson(5)],
      error: null,
      status: 200,
    });

    const outcome = await sendRoundBatch(
      flight(
        shotCleared({ eventId: "a" }),
        shotCleared({ eventId: "b", arrowNumber: 2 }),
      ),
    );

    expect(outcome).toEqual({ ok: true, results: [resultOf(4), resultOf(5)] });
    expect(client.rpc).toHaveBeenCalledWith("clear_shots", {
      p_shots: [
        expect.objectContaining({ shot_event_id: "a" }),
        expect.objectContaining({ shot_event_id: "b" }),
      ],
    });
  });

  it("取り消し1件はclear_shotsへ送る", async () => {
    client.rpc.mockResolvedValue({
      data: [resultJson(4)],
      error: null,
      status: 200,
    });

    await sendRoundBatch(flight(shotCleared()));

    expect(client.rpc.mock.calls[0]?.[0]).toBe("clear_shots");
  });

  it("update_roundとupdate_distanceへ、変えた項目だけをp_changesで送る", async () => {
    await sendRoundBatch(
      flight(
        roundUpdated({
          changes: { roundDate: "2026-10-01", bowType: "compound" },
        }),
      ),
    );
    await sendRoundBatch(
      flight(
        distanceUpdated({
          changes: {
            distance: null,
            isMarked: false,
            config: { totalEnds: 3, arrowsPerEnd: 4, targetFaceId: "f" },
          },
        }),
      ),
    );

    expect(client.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_changes: { round_date: "2026-10-01", bow_type: "compound" },
    });
    expect(client.rpc.mock.calls[0]?.[1].p_changes).not.toHaveProperty("name");
    expect(client.rpc.mock.calls[1]?.[1]).toMatchObject({
      p_changes: {
        distance: null,
        is_marked: false,
        config: { total_ends: 3, arrows_per_end: 4, target_face_id: "f" },
      },
    });
  });

  it("効かなかった操作は、revisionなしの判定結果として返す", async () => {
    client.rpc.mockResolvedValue({
      data: resultJson(null),
      error: null,
      status: 200,
    });

    expect(await sendRoundBatch(flight(distanceUpdated()))).toEqual({
      ok: true,
      results: [resultOf(null)],
    });
  });

  it("一部の項目だけが効いた操作は、効いた項目と拒否した項目を返す", async () => {
    client.rpc.mockResolvedValue({
      data: {
        revision: 3,
        applied: true,
        applied_fields: ["name"],
        rejected_fields: [{ field: "format", reason: "INVARIANT" }],
        reason: null,
      },
      error: null,
      status: 200,
    });

    expect(await sendRoundBatch(flight(roundUpdated()))).toEqual({
      ok: true,
      results: [
        {
          revision: 3,
          applied: true,
          appliedFields: ["name"],
          rejectedFields: [{ field: "format", reason: "INVARIANT" }],
          reason: null,
        },
      ],
    });
  });

  it("判定結果の拒否した項目の形が不正なら、失敗として返す", async () => {
    client.rpc.mockResolvedValue({
      data: { ...resultJson(), rejected_fields: [{ field: 1 }] },
      error: null,
      status: 200,
    });

    expect(await sendRoundBatch(flight(roundUpdated()))).toMatchObject({
      ok: false,
    });
  });

  it("RPCがエラーを返せば、分類した失敗を返す", async () => {
    client.rpc.mockResolvedValue({
      data: null,
      error: { message: "拒否", code: "P0001" },
      status: 400,
    });

    const outcome = await sendRoundBatch(flight(roundUpdated()));

    expect(outcome).toMatchObject({ ok: false, failure: { error: "拒否" } });
  });

  it("矢の束のRPCがエラーを返せば、失敗を返す", async () => {
    client.rpc.mockResolvedValue({
      data: null,
      error: { message: "拒否", code: "P0001" },
      status: 400,
    });

    const outcome = await sendRoundBatch(
      flight(
        shotRecorded({ eventId: "a" }),
        shotRecorded({ eventId: "b", arrowNumber: 2 }),
      ),
    );

    expect(outcome).toMatchObject({ ok: false });
  });

  it("矢1件のRPCがエラーを返せば、失敗を返す", async () => {
    client.rpc.mockResolvedValue({
      data: null,
      error: { message: "拒否", code: "P0001" },
      status: 400,
    });

    expect(await sendRoundBatch(flight(shotCleared()))).toMatchObject({
      ok: false,
    });
  });

  it.each([
    ["単独の操作が判定結果を返さない", flight(roundUpdated()), null],
    [
      "矢の束の件数が合わない",
      flight(
        shotRecorded({ eventId: "a" }),
        shotRecorded({ eventId: "b", arrowNumber: 2 }),
      ),
      [resultJson(1)],
    ],
    [
      "矢の束が判定結果でない値を含む",
      flight(
        shotRecorded({ eventId: "a" }),
        shotRecorded({ eventId: "b", arrowNumber: 2 }),
      ),
      [resultJson(1), "x"],
    ],
  ])("応答が不正なら、失敗として返す: %s", async (_name, request, data) => {
    client.rpc.mockResolvedValue({ data, error: null, status: 200 });

    const outcome = await sendRoundBatch(request);

    expect(outcome).toMatchObject({
      ok: false,
      failure: { cause: { type: "exception" } },
    });
  });

  it("未認証なら、RPCを呼ばずに認証の失敗を返す", async () => {
    client.getSession.mockResolvedValue({ data: { session: null } });

    const outcome = await sendRoundBatch(flight(roundUpdated()));

    expect(outcome).toMatchObject({
      ok: false,
      failure: { cause: { type: "unauthenticated" } },
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("列のユーザーとセッションのユーザーが違えば、送らずに未認証の失敗を返す", async () => {
    const outcome = await sendRoundBatch(flight(roundUpdated()), "user-2");

    expect(outcome).toMatchObject({
      ok: false,
      failure: { cause: { type: "unauthenticated" } },
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("列のユーザーがnullなら、照合せずに送る", async () => {
    const outcome = await sendRoundBatch(flight(roundUpdated()), null);

    expect(outcome).toMatchObject({ ok: true });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });
});
