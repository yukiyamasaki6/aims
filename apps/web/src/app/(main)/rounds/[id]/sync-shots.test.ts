import { beforeEach, expect, it, vi } from "vitest";
import { syncShots } from "./sync-shots";

const db = vi.hoisted(() => ({
  getUser: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  or: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: db.getUser },
    from: () => ({ upsert: db.upsert, delete: db.remove }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  db.getUser.mockResolvedValue({ data: { user: { id: "editor" } } });
  db.upsert.mockResolvedValue({ error: null });
  db.remove.mockReturnValue({ or: db.or });
  db.or.mockResolvedValue({ error: null });
});

it("代理修正でも射手を保持し、同じ矢の位置を更新する", async () => {
  await syncShots({
    upsert: [
      {
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
  expect(db.upsert).toHaveBeenCalledWith(
    [expect.objectContaining({ shooter_id: "shooter", score_int: 9 })],
    { onConflict: "distance_id,end_number,arrow_number" },
  );
});

it("射手が未指定の新規入力は本人の矢として記録する", async () => {
  await syncShots({
    upsert: [
      {
        distanceId: "distance",
        endNumber: 1,
        arrowNumber: 1,
        scoreStr: "X",
        scoreInt: 10,
      },
    ],
    clear: [],
  });
  expect(db.upsert).toHaveBeenCalledWith(
    [expect.objectContaining({ shooter_id: "editor" })],
    expect.anything(),
  );
});

it("クリア対象を射手で制限せず、編集権限の検証をRLSに委ねる", async () => {
  await expect(
    syncShots({
      upsert: [],
      clear: [{ distanceId: "distance", endNumber: 1, arrowNumber: 2 }],
    }),
  ).resolves.toBeUndefined();
  expect(db.or).toHaveBeenCalledWith(
    "and(distance_id.eq.distance,end_number.eq.1,arrow_number.eq.2)",
  );
});

it("未認証では書き込まない", async () => {
  db.getUser.mockResolvedValue({ data: { user: null } });
  expect(await syncShots({ upsert: [], clear: [] })).toEqual({
    error: "サインインが必要です。",
  });
  expect(db.upsert).not.toHaveBeenCalled();
  expect(db.remove).not.toHaveBeenCalled();
});
