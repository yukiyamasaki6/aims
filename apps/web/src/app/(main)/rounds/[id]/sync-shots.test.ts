import { beforeEach, expect, it, vi } from "vitest";
import { syncShots } from "./sync-shots";

const db = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: db.getUser },
    rpc: db.rpc,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  db.getUser.mockResolvedValue({ data: { user: { id: "editor" } } });
  db.rpc.mockResolvedValue({ error: null });
});

it("代理修正でも射手を保持し、同じ矢の位置を更新する", async () => {
  await syncShots({
    upsert: [
      {
        shotEventId: "event-1",
        distanceId: "distance",
        endNumber: 1,
        arrowNumber: 2,
        scoreStr: "9",
        scoreInt: 9,
        shooterId: "shooter",
      },
    ],
    clear: [],
  });
  expect(db.rpc).toHaveBeenCalledWith("record_shots", {
    p_shots: [expect.objectContaining({ shooter_id: "shooter", score_int: 9 })],
  });
});

it("射手が未指定の新規入力は本人の矢として記録する", async () => {
  await syncShots({
    upsert: [
      {
        shotEventId: "event-1",
        distanceId: "distance",
        endNumber: 1,
        arrowNumber: 1,
        scoreStr: "X",
        scoreInt: 10,
      },
    ],
    clear: [],
  });
  expect(db.rpc).toHaveBeenCalledWith("record_shots", {
    p_shots: [expect.objectContaining({ shooter_id: "editor" })],
  });
});

it("クリア対象を射手で制限せず、編集権限の検証をRPCに委ねる", async () => {
  await expect(
    syncShots({
      upsert: [],
      clear: [
        {
          shotEventId: "event-2",
          distanceId: "distance",
          endNumber: 1,
          arrowNumber: 2,
        },
      ],
    }),
  ).resolves.toBeUndefined();
  expect(db.rpc).toHaveBeenCalledWith("clear_shots", {
    p_shots: [
      {
        shot_event_id: "event-2",
        distance_id: "distance",
        end_number: 1,
        arrow_number: 2,
      },
    ],
  });
});

it("未認証では書き込まない", async () => {
  db.getUser.mockResolvedValue({ data: { user: null } });
  expect(await syncShots({ upsert: [], clear: [] })).toEqual({
    error: "サインインが必要です。",
    permanent: true,
  });
  expect(db.rpc).not.toHaveBeenCalled();
});
