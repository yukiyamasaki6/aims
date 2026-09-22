import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventIdOf,
  executeSyncOperation,
  type SyncOperation,
} from "./sync-events";

const db = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: db.getSession },
    rpc: db.rpc,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  db.getSession.mockResolvedValue({
    data: { session: { user: { id: "editor" } } },
  });
  db.rpc.mockResolvedValue({ error: null });
});

it("eventIdOfはoperationのeventIdをそのまま返す", () => {
  const operation: SyncOperation = {
    type: "round.disabled",
    eventId: "event-1",
    roundId: "round-1",
  };
  expect(eventIdOf(operation)).toBe("event-1");
});

it("未認証ではRPCを呼ばずエラーを返す", async () => {
  db.getSession.mockResolvedValue({ data: { session: null } });
  const result = await executeSyncOperation({
    type: "round.disabled",
    eventId: "event-1",
    roundId: "round-1",
  });
  expect(result).toEqual({ error: "サインインが必要です。", permanent: true });
  expect(db.rpc).not.toHaveBeenCalled();
});

describe("operationの種類ごとに正しいRPCを呼ぶ", () => {
  it("round.updated → update_round", async () => {
    await executeSyncOperation({
      type: "round.updated",
      eventId: "event-1",
      roundId: "round-1",
      name: "Practice",
      roundDate: "2026-09-22",
      format: "WA70",
      bowType: "recurve",
    });
    expect(db.rpc).toHaveBeenCalledWith("update_round", {
      p_round_event_id: "event-1",
      p_round_id: "round-1",
      p_name: "Practice",
      p_round_date: "2026-09-22",
      p_format: "WA70",
      p_bow_type: "recurve",
    });
  });

  it("round.disabled → disable_round", async () => {
    await executeSyncOperation({
      type: "round.disabled",
      eventId: "event-1",
      roundId: "round-1",
    });
    expect(db.rpc).toHaveBeenCalledWith("disable_round", {
      p_round_event_id: "event-1",
      p_round_id: "round-1",
    });
  });

  it("distance.created → create_distance", async () => {
    await executeSyncOperation({
      type: "distance.created",
      eventId: "event-1",
      id: "distance-1",
      roundId: "round-1",
      positionKey: "1-1",
      distance: 70,
      totalEnds: 6,
      arrowsPerEnd: 6,
      targetFaceId: "face-1",
      isMarked: false,
    });
    expect(db.rpc).toHaveBeenCalledWith("create_distance", {
      p_distance_event_id: "event-1",
      p_id: "distance-1",
      p_round_id: "round-1",
      p_position_key: "1-1",
      p_distance: 70,
      p_total_ends: 6,
      p_arrows_per_end: 6,
      p_target_face_id: "face-1",
      p_is_marked: false,
    });
  });

  it("distance.updated → update_distance", async () => {
    await executeSyncOperation({
      type: "distance.updated",
      eventId: "event-1",
      distanceId: "distance-1",
      distance: 50,
      totalEnds: 6,
      arrowsPerEnd: 6,
      targetFaceId: "face-1",
      isMarked: true,
    });
    expect(db.rpc).toHaveBeenCalledWith("update_distance", {
      p_distance_event_id: "event-1",
      p_distance_id: "distance-1",
      p_distance: 50,
      p_total_ends: 6,
      p_arrows_per_end: 6,
      p_target_face_id: "face-1",
      p_is_marked: true,
    });
  });

  it("distance.disabled → disable_distance", async () => {
    await executeSyncOperation({
      type: "distance.disabled",
      eventId: "event-1",
      distanceId: "distance-1",
    });
    expect(db.rpc).toHaveBeenCalledWith("disable_distance", {
      p_distance_event_id: "event-1",
      p_distance_id: "distance-1",
    });
  });

  it("shot.recorded → record_shots（shooterId省略時は本人IDを使う）", async () => {
    await executeSyncOperation({
      type: "shot.recorded",
      eventId: "event-1",
      distanceId: "distance-1",
      endNumber: 1,
      arrowNumber: 1,
      scoreStr: "X",
      scoreInt: 10,
    });
    expect(db.rpc).toHaveBeenCalledWith("record_shots", {
      p_shots: [
        {
          shot_event_id: "event-1",
          distance_id: "distance-1",
          end_number: 1,
          arrow_number: 1,
          shooter_id: "editor",
          score_str: "X",
          score_int: 10,
        },
      ],
    });
  });

  it("shot.cleared → clear_shots", async () => {
    await executeSyncOperation({
      type: "shot.cleared",
      eventId: "event-1",
      distanceId: "distance-1",
      endNumber: 1,
      arrowNumber: 1,
    });
    expect(db.rpc).toHaveBeenCalledWith("clear_shots", {
      p_shots: [
        {
          shot_event_id: "event-1",
          distance_id: "distance-1",
          end_number: 1,
          arrow_number: 1,
        },
      ],
    });
  });
});

describe("エラー時のpermanent判定", () => {
  it("業務ルール違反（P0001）はpermanentとして扱う", async () => {
    db.rpc.mockResolvedValue({
      error: { message: "duplicate", code: "P0001" },
    });
    const result = await executeSyncOperation({
      type: "round.disabled",
      eventId: "event-1",
      roundId: "round-1",
    });
    expect(result).toEqual({ error: "duplicate", permanent: true });
  });

  it("RLS拒否（42501）はpermanentとして扱う", async () => {
    db.rpc.mockResolvedValue({
      error: { message: "forbidden", code: "42501" },
    });
    const result = await executeSyncOperation({
      type: "round.disabled",
      eventId: "event-1",
      roundId: "round-1",
    });
    expect(result).toEqual({ error: "forbidden", permanent: true });
  });

  it("それ以外のエラーはpermanentを付けず再試行可能とする", async () => {
    db.rpc.mockResolvedValue({
      error: { message: "network error", code: "08006" },
    });
    const result = await executeSyncOperation({
      type: "round.disabled",
      eventId: "event-1",
      roundId: "round-1",
    });
    expect(result).toEqual({ error: "network error", permanent: false });
  });

  it("エラーがなければundefinedを返す", async () => {
    const result = await executeSyncOperation({
      type: "round.disabled",
      eventId: "event-1",
      roundId: "round-1",
    });
    expect(result).toBeUndefined();
  });
});
