import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  distanceCreated,
  distanceDisabled,
  distanceUpdated,
  roundDisabled,
  roundUpdated,
  shotCleared,
  shotRecorded,
} from "./round-op-test-helpers";
import { sendRoundBatch } from "./round-op-transport";
import type { SyncOperation } from "./sync-events";

const client = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: client.getSession },
    rpc: client.rpc,
  }),
}));

function flight(...operations: SyncOperation[]) {
  return {
    lane: "lane",
    entries: operations.map((operation) => ({
      eventId: operation.eventId,
      operation,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  client.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
  });
  client.rpc.mockResolvedValue({ data: 5, error: null, status: 200 });
});

describe("sendRoundBatch", () => {
  it.each([
    ["update_round", roundUpdated()],
    ["disable_round", roundDisabled()],
    ["create_distance", distanceCreated()],
    ["update_distance", distanceUpdated()],
    ["disable_distance", distanceDisabled()],
  ])("単独の操作は%sで送り、確定したrevisionを返す", async (rpc, operation) => {
    const outcome = await sendRoundBatch(flight(operation));

    expect(outcome).toEqual({ ok: true, revisions: [5] });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc.mock.calls[0]?.[0]).toBe(rpc);
  });

  it("矢1件の記録は、射手の指定が無ければ自分のIDでrecord_shotsへ送る", async () => {
    client.rpc.mockResolvedValue({ data: [7], error: null, status: 200 });

    const outcome = await sendRoundBatch(flight(shotRecorded()));

    expect(outcome).toEqual({ ok: true, revisions: [7] });
    expect(client.rpc).toHaveBeenCalledWith("record_shots", {
      p_shots: [expect.objectContaining({ shooter_id: "user-1" })],
    });
  });

  it("矢の束は1回のRPCへ列の順で詰め、revisionを同じ順で返す", async () => {
    client.rpc.mockResolvedValue({ data: [2, 3], error: null, status: 200 });

    const outcome = await sendRoundBatch(
      flight(
        shotRecorded({ eventId: "a", shooterId: "other" }),
        shotRecorded({ eventId: "b", arrowNumber: 2 }),
      ),
    );

    expect(outcome).toEqual({ ok: true, revisions: [2, 3] });
    expect(client.rpc).toHaveBeenCalledWith("record_shots", {
      p_shots: [
        expect.objectContaining({ shot_event_id: "a", shooter_id: "other" }),
        expect.objectContaining({ shot_event_id: "b", shooter_id: "user-1" }),
      ],
    });
  });

  it("取り消しの束はclear_shotsへ送る", async () => {
    client.rpc.mockResolvedValue({ data: [4, 5], error: null, status: 200 });

    const outcome = await sendRoundBatch(
      flight(
        shotCleared({ eventId: "a" }),
        shotCleared({ eventId: "b", arrowNumber: 2 }),
      ),
    );

    expect(outcome).toEqual({ ok: true, revisions: [4, 5] });
    expect(client.rpc).toHaveBeenCalledWith("clear_shots", {
      p_shots: [
        expect.objectContaining({ shot_event_id: "a" }),
        expect.objectContaining({ shot_event_id: "b" }),
      ],
    });
  });

  it("取り消し1件はclear_shotsへ送る", async () => {
    client.rpc.mockResolvedValue({ data: [4], error: null, status: 200 });

    await sendRoundBatch(flight(shotCleared()));

    expect(client.rpc.mock.calls[0]?.[0]).toBe("clear_shots");
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
    ["単独の操作がrevisionを返さない", flight(roundUpdated()), null],
    [
      "矢の束の件数が合わない",
      flight(
        shotRecorded({ eventId: "a" }),
        shotRecorded({ eventId: "b", arrowNumber: 2 }),
      ),
      [1],
    ],
    [
      "矢の束がrevisionでない値を含む",
      flight(
        shotRecorded({ eventId: "a" }),
        shotRecorded({ eventId: "b", arrowNumber: 2 }),
      ),
      [1, "x"],
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
});
