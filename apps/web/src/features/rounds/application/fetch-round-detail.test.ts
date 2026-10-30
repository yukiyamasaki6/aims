import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type {
  DatabaseGateway,
  DbResponse,
} from "@/lib/supabase/contract/database";
import {
  FALLBACK_WAIT_MS,
  FETCH_ERROR_MESSAGE,
  FETCH_TIMEOUT_MS,
  type ResponseLike,
} from "../domain/fetch-result";
import type { ServerRound } from "../domain/round-tables";
import type { TargetFaceRecord } from "../domain/target-face-types";
import { createRoundQueries } from "../infrastructure/round-queries";
import type { RoundsDbSchema } from "../infrastructure/rounds-db-schema";

import { createContentFetcher, type SignInReader } from "./fetch-content";
import {
  createRoundFetching,
  type ReferenceSnapshots,
  type RoundQueries,
} from "./fetch-round-detail";

const AUTH_REQUIRED_MESSAGE = "サインインが必要です。";

function face(
  id: string,
  ownerId: string | null,
  overrides: Partial<TargetFaceRecord> = {},
): TargetFaceRecord {
  return {
    id,
    name: id,
    size: 122,
    format: "outdoor",
    bow_type: ["recurve"],
    owner_id: ownerId,
    target_face_spots: [],
    ...overrides,
  };
}

const distanceA = {
  id: "d-a",
  position_key: "a",
  distance: 70,
  total_ends: 6,
  arrows_per_end: 6,
  target_face_id: "face-1",
  is_marked: true,
};
const shotA = {
  id: "s-a",
  distance_id: "d-a",
  end_number: 1,
  shooter_id: "user-1",
  score_str: "X",
  score_int: 10,
  shot_number: null,
};

const serverRound: ServerRound = {
  id: "round-1",
  roundConfig: {
    name: "午前練習",
    roundDate: "2026-09-15",
    format: "outdoor",
    bowType: "recurve",
  },
  status: "completed",
  revision: 3,
  distances: [
    {
      ...distanceA,
      revision: 4,
      disabled: false,
      shots: [{ ...shotA, revision: 5, disabled: false }],
    },
  ],
};

const okResponse = <T>(data: T): ResponseLike<T> => ({
  data,
  error: null,
  status: 200,
});

// 参照データの保存は端末の境界のため、利用者ごとのメモリで模す。読む利用者は、テストが切り替える。
function memorySnapshots(initial: TargetFaceRecord[] | null = null) {
  const saved = new Map<string, { startedAt: number; data: unknown }>();
  const identity = { userId: "user-1" };
  if (initial) saved.set("user-1", { startedAt: 1, data: initial });
  const save = vi.fn<ReferenceSnapshots["save"]>(
    (_kind, userId, data, startedAt) => {
      const current = saved.get(userId);
      if (current && current.startedAt > startedAt) return;
      saved.set(userId, { startedAt, data });
    },
  );
  const snapshots: ReferenceSnapshots = {
    load: <T>() => (saved.get(identity.userId)?.data ?? null) as T | null,
    save,
  };
  return { snapshots, saved, identity, save };
}

type Readings = Parameters<typeof makeSignIn>[0];

function makeSignIn(reading: Awaited<ReturnType<SignInReader["read"]>>) {
  return { read: vi.fn(async () => reading) } satisfies SignInReader;
}

function setup(
  options: {
    queries?: Partial<RoundQueries>;
    saved?: TargetFaceRecord[] | null;
    offline?: boolean;
    signIn?: Readings;
  } = {},
) {
  const clock = createManualClock(1000);
  const state = { offline: options.offline ?? false };
  const connectivity: Connectivity = {
    isOffline: () => state.offline,
    onOnline: () => () => {},
    onOffline: () => () => {},
  };
  const signIn = makeSignIn(
    options.signIn ?? { status: "authenticated", userId: "user-1" },
  );
  const content = createContentFetcher({ signIn, connectivity, clock });
  const memory = memorySnapshots(options.saved);
  const queries: RoundQueries = {
    roundDetail: vi.fn(async () =>
      okResponse({ round: serverRound, targetFaces: [] }),
    ),
    roundDetails: vi.fn(async () =>
      okResponse({ rounds: [serverRound], targetFaces: [] }),
    ),
    targetFaces: vi.fn(async () => okResponse<TargetFaceRecord[]>([])),
    ...options.queries,
  };
  const fetching = createRoundFetching({
    content,
    queries,
    snapshots: memory.snapshots,
    clock,
  });
  return { fetching, queries, clock, state, signIn, ...memory };
}

const idsOf = (faces: unknown) => (faces as { id: string }[]).map((f) => f.id);

describe("fetchRoundDetail", () => {
  it("ラウンドの設定・距離・全距離の記録を、スコアカードが扱う形で、取得の開始時刻と利用者を付けて返す", async () => {
    // Given
    const { fetching } = setup();

    // When
    const result = await fetching.fetchRoundDetail("round-1");

    // Then
    expect(result).toEqual({
      status: "ok",
      data: {
        status: "completed",
        roundConfig: serverRound.roundConfig,
        distances: [distanceA],
        shots: [shotA],
        targetFaces: [],
        revisions: {
          round: 3,
          distances: { "d-a": 4 },
          shots: { "s-a": 5 },
        },
        startedAt: 1000,
        userId: "user-1",
      },
    });
  });

  it("確かめたセッションの利用者で問い合わせ、的は個人を先に並べて返し、並べた的を取得の開始時刻でその利用者のキーへ保存する", async () => {
    // Given
    const faces = [face("g", null), face("p", "user-1")];
    const { fetching, queries, save } = setup({
      queries: {
        roundDetail: vi.fn(async () =>
          okResponse({ round: serverRound, targetFaces: faces }),
        ),
      },
    });

    // When
    const result = await fetching.fetchRoundDetail("round-1");

    // Then
    expect(queries.roundDetail).toHaveBeenCalledExactlyOnceWith(
      "user-1",
      "round-1",
    );
    expect(result.status === "ok" && idsOf(result.data.targetFaces)).toEqual([
      "p",
      "g",
    ]);
    expect(save).toHaveBeenCalledWith(
      "target-faces",
      "user-1",
      expect.arrayContaining([expect.objectContaining({ id: "p" })]),
      1000,
    );
  });

  it("ラウンドが見つからないときは、not-foundを返し、的は保存しない", async () => {
    // Given
    const { fetching, save } = setup({
      queries: {
        roundDetail: vi.fn(async () => ({
          data: null,
          error: null,
          status: 200,
        })),
      },
    });

    // When
    const result = await fetching.fetchRoundDetail("round-1");

    // Then
    expect(result).toEqual({ status: "not-found" });
    expect(save).not.toHaveBeenCalled();
  });

  it("失敗のときは、保存済みがあっても代わりにせず、結果をそのまま返す", async () => {
    // Given
    const { fetching, queries } = setup({
      saved: [face("saved", null)],
      offline: true,
    });

    // When
    const result = await fetching.fetchRoundDetail("round-1");

    // Then
    expect(result).toEqual({ status: "offline" });
    expect(queries.roundDetail).not.toHaveBeenCalled();
  });

  it("サインインが必要なときは、問い合わせずに約束の文言のerrorを返す", async () => {
    // Given
    const { fetching, queries } = setup({
      signIn: { status: "unauthenticated", message: AUTH_REQUIRED_MESSAGE },
    });

    // When
    const result = await fetching.fetchRoundDetail("round-1");

    // Then
    expect(result).toEqual({ status: "error", message: AUTH_REQUIRED_MESSAGE });
    expect(queries.roundDetail).not.toHaveBeenCalled();
  });

  it("問い合わせの失敗(サーバーエラー、通信失敗)は取得エラーにする", async () => {
    // Given
    const serverError = setup({
      queries: {
        roundDetail: vi.fn(async () => ({
          data: null,
          error: { message: "boom" },
          status: 500,
        })),
      },
    });
    const commError = setup({
      queries: {
        roundDetail: vi.fn(async () => ({
          data: null,
          error: null,
          status: 0,
        })),
      },
    });

    // When
    const first = await serverError.fetching.fetchRoundDetail("r");
    const second = await commError.fetching.fetchRoundDetail("r");

    // Then
    expect(first).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
    expect(second).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
  });

  it("待ちは10秒のままで、FALLBACK_WAIT_MSでは返らない", async () => {
    // Given
    const { fetching, clock } = setup({
      saved: [face("saved", null)],
      queries: { roundDetail: () => new Promise<never>(() => {}) },
    });
    let settled = false;
    const pending = fetching.fetchRoundDetail("round-1").finally(() => {
      settled = true;
    });

    // When
    await clock.advanceAsync(FALLBACK_WAIT_MS);
    const settledAtFallback = settled;
    await clock.advanceAsync(FETCH_TIMEOUT_MS - FALLBACK_WAIT_MS);

    // Then
    expect(settledAtFallback).toBe(false);
    await expect(pending).resolves.toEqual({
      status: "error",
      message: FETCH_ERROR_MESSAGE,
    });
  });

  it("問い合わせ(実物)の応答が、変換を通って取得の結果に届く", async () => {
    // Given
    const rows: Record<string, DbResponse> = {
      rounds: {
        data: {
          id: "round-1",
          name: "午前練習",
          round_date: "2026-09-15",
          format: "outdoor",
          bow_type: "recurve",
          status: "completed",
          revision: 3,
          distances: [
            {
              ...distanceA,
              revision: 4,
              disabled_at: null,
              shots: [{ ...shotA, revision: 5, disabled_at: "2026-09-16" }],
            },
          ],
        },
        error: null,
        status: 200,
      },
      target_faces: {
        data: [face("g", null)],
        error: null,
        status: 200,
      },
    };
    const database: DatabaseGateway<RoundsDbSchema> = {
      select: async (query) => rows[query.table],
      rpc: async () => {
        throw new Error("使わない");
      },
    };
    const { fetching } = setup({ queries: createRoundQueries(database) });

    // When
    const result = await fetching.fetchRoundDetail("round-1");

    // Then
    expect(result).toMatchObject({
      status: "ok",
      data: {
        distances: [distanceA],
        shots: [],
        revisions: { shots: { "s-a": 5 } },
        targetFaces: [face("g", null)],
      },
    });
  });
});

describe("fetchTargetFaces", () => {
  const savedFaces = [face("saved", null)];

  it("取得できたときは、並べて返し、取得の開始時刻でその利用者のキーへ保存して、保存済みを最新にする", async () => {
    // Given
    const { fetching, saved } = setup({
      saved: savedFaces,
      queries: {
        targetFaces: vi.fn(async () =>
          okResponse([face("own", "user-1"), face("common", null)]),
        ),
      },
    });

    // When
    const result = await fetching.fetchTargetFaces();

    // Then
    expect(result.status === "ok" && idsOf(result.data)).toEqual([
      "own",
      "common",
    ]);
    expect(idsOf(saved.get("user-1")?.data)).toEqual(["own", "common"]);
    expect(saved.get("user-1")?.startedAt).toBe(1000);
  });

  it.each([
    ["通信失敗", { data: null, error: null, status: 0 }],
    ["サーバーエラー", { data: null, error: { message: "x" }, status: 500 }],
  ])("%sのとき、保存済みがあれば保存済みを返す", async (_name, response) => {
    // Given
    const { fetching } = setup({
      saved: savedFaces,
      queries: { targetFaces: vi.fn(async () => response) },
    });

    // When
    const result = await fetching.fetchTargetFaces();

    // Then
    expect(result).toEqual({ status: "ok", data: savedFaces });
  });

  it("オフラインのとき、保存済みがあれば保存済みを、無ければofflineを返す", async () => {
    // Given
    const withSaved = setup({ saved: savedFaces, offline: true });
    const withoutSaved = setup({ offline: true });

    // When
    const first = await withSaved.fetching.fetchTargetFaces();
    const second = await withoutSaved.fetching.fetchTargetFaces();

    // Then
    expect(first).toEqual({ status: "ok", data: savedFaces });
    expect(second).toEqual({ status: "offline" });
  });

  it("保存済みがあると、FALLBACK_WAIT_MSで終わらない取得を待たず保存済みを返す", async () => {
    // Given
    const { fetching, clock } = setup({
      saved: savedFaces,
      queries: { targetFaces: () => new Promise<never>(() => {}) },
    });
    const pending = fetching.fetchTargetFaces();

    // When
    await clock.advanceAsync(FALLBACK_WAIT_MS);

    // Then
    await expect(pending).resolves.toEqual({ status: "ok", data: savedFaces });
  });

  it("保存済みが無いと、FALLBACK_WAIT_MSでは返らず、FETCH_TIMEOUT_MSでerrorになる", async () => {
    // Given
    const { fetching, clock } = setup({
      queries: { targetFaces: () => new Promise<never>(() => {}) },
    });
    let settled = false;
    const pending = fetching.fetchTargetFaces().finally(() => {
      settled = true;
    });

    // When
    await clock.advanceAsync(FALLBACK_WAIT_MS);
    const settledAtFallback = settled;
    await clock.advanceAsync(FETCH_TIMEOUT_MS - FALLBACK_WAIT_MS);

    // Then
    expect(settledAtFallback).toBe(false);
    await expect(pending).resolves.toEqual({
      status: "error",
      message: FETCH_ERROR_MESSAGE,
    });
  });

  it("時間切れの後に届いたokは表示に使わず、開始時の利用者のキーへ保存し、読む利用者が変わっても新しい利用者のキーへは書かない", async () => {
    // Given
    const { fetching, clock, saved, identity } = setup({
      saved: savedFaces,
      queries: {
        targetFaces: vi.fn(
          () =>
            new Promise<ResponseLike<TargetFaceRecord[]>>((resolve) => {
              clock.after(3000, () =>
                resolve(okResponse([face("late", null)])),
              );
            }),
        ),
      },
    });
    const pending = fetching.fetchTargetFaces();
    await clock.advanceAsync(FALLBACK_WAIT_MS);
    const shown = await pending;
    identity.userId = "user-2";

    // When
    await clock.advanceAsync(3000);

    // Then
    expect(shown).toEqual({ status: "ok", data: savedFaces });
    expect(idsOf(saved.get("user-1")?.data)).toEqual(["late"]);
    expect(saved.has("user-2")).toBe(false);
  });

  it("時間切れの後に届いた結果がok以外なら、保存済みは変わらない", async () => {
    // Given
    const { fetching, clock, saved } = setup({
      saved: savedFaces,
      queries: {
        targetFaces: vi.fn(
          () =>
            new Promise<ResponseLike<TargetFaceRecord[]>>((resolve) => {
              clock.after(3000, () =>
                resolve({ data: null, error: { message: "x" }, status: 500 }),
              );
            }),
        ),
      },
    });
    const pending = fetching.fetchTargetFaces();
    await clock.advanceAsync(FALLBACK_WAIT_MS);
    await pending;

    // When
    await clock.advanceAsync(3000);

    // Then
    expect(saved.get("user-1")?.data).toEqual(savedFaces);
  });
});

describe("fetchRoundDetails", () => {
  const uuid1 = "11111111-1111-4111-8111-111111111111";

  it("返ったラウンドをラウンドIDごとの記録にし、的を並べて保存し、取得の開始時刻と利用者を持つ", async () => {
    // Given
    const { fetching, queries, saved } = setup({
      queries: {
        roundDetails: vi.fn(async () =>
          okResponse({
            rounds: [
              { ...serverRound, id: uuid1, status: "in_progress" as const },
              serverRound,
            ],
            targetFaces: [face("g", null)],
          }),
        ),
      },
    });

    // When
    const result = await fetching.fetchRoundDetails([uuid1]);

    // Then
    expect(queries.roundDetails).toHaveBeenCalledExactlyOnceWith("user-1", [
      uuid1,
    ]);
    if (result.status !== "ok") throw new Error("not ok");
    expect([...result.data.rounds.keys()]).toEqual([uuid1, "round-1"]);
    expect(result.data.rounds.get(uuid1)).toMatchObject({
      status: "in_progress",
      revisions: { round: 3 },
      userId: "user-1",
      startedAt: result.data.startedAt,
    });
    expect(result.data.startedAt).toBe(1000);
    expect(idsOf(saved.get("user-1")?.data)).toEqual(["g"]);
  });

  it("サインインが必要なときは、取得せずに約束の文言のerrorを返す", async () => {
    // Given
    const { fetching, queries } = setup({
      signIn: { status: "unauthenticated", message: AUTH_REQUIRED_MESSAGE },
    });

    // When
    const result = await fetching.fetchRoundDetails([]);

    // Then
    expect(result).toEqual({ status: "error", message: AUTH_REQUIRED_MESSAGE });
    expect(queries.roundDetails).not.toHaveBeenCalled();
  });

  it("取得に失敗したときは、そのまま返し、的を保存しない", async () => {
    // Given
    const { fetching, save } = setup({
      queries: {
        roundDetails: vi.fn(async () => ({
          data: null,
          error: null,
          status: 0,
        })),
      },
    });

    // When
    const result = await fetching.fetchRoundDetails([]);

    // Then
    expect(result.status).toBe("error");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("savedTargetFaces", () => {
  it("端末に保存した的の一覧を返す。無ければnullを返す", () => {
    // Given
    const withSaved = setup({ saved: [face("saved", null)] });
    const without = setup();

    // When
    const first = withSaved.fetching.savedTargetFaces();
    const second = without.fetching.savedTargetFaces();

    // Then
    expect(first).toEqual([face("saved", null)]);
    expect(second).toBeNull();
  });
});
