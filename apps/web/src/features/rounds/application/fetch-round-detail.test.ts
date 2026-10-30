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
import type { PresetRecord, Presets } from "../domain/preset";
import type { ServerRoundSummary } from "../domain/round-list";
import type { ServerRound } from "../domain/round-tables";
import type { TargetFaceRecord } from "../domain/target-face-types";
import { createRoundQueries } from "../infrastructure/round-queries";
import type { RoundsDbSchema } from "../infrastructure/rounds-db-schema";

import { createContentFetcher } from "./fetch-content";
import { createRoundFetching, type RoundQueries } from "./fetch-round-detail";
import type { ReferenceKind, ReferenceSnapshots } from "./reference-snapshots";
import type { SignInReader } from "./sign-in-reader";

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

// 参照データの保存は端末の境界のため、種類と利用者ごとのメモリで模す。読む利用者は、テストが切り替える。
// savedは的の保存、savedPresetsはプリセットの保存(どちらも利用者のIDがキー)。
function memorySnapshots(
  initial: {
    targetFaces?: TargetFaceRecord[] | null;
    presets?: Presets | null;
  } = {},
) {
  type Entry = { startedAt: number; data: unknown };
  const saved = new Map<string, Entry>();
  const savedPresets = new Map<string, Entry>();
  const stores: Record<ReferenceKind, Map<string, Entry>> = {
    "target-faces": saved,
    presets: savedPresets,
  };
  const identity = { userId: "user-1" };
  if (initial.targetFaces) {
    saved.set("user-1", { startedAt: 1, data: initial.targetFaces });
  }
  if (initial.presets) {
    savedPresets.set("user-1", { startedAt: 1, data: initial.presets });
  }
  const save = vi.fn<ReferenceSnapshots["save"]>(
    (kind, userId, data, startedAt) => {
      const current = stores[kind].get(userId);
      if (current && current.startedAt > startedAt) return;
      stores[kind].set(userId, { startedAt, data });
    },
  );
  const snapshots: ReferenceSnapshots = {
    load: <T>(kind: ReferenceKind) =>
      (stores[kind].get(identity.userId)?.data ?? null) as T | null,
    save,
    update: <T>(kind: ReferenceKind, change: (data: T) => T) => {
      const current = stores[kind].get(identity.userId);
      if (current) {
        stores[kind].set(identity.userId, {
          ...current,
          data: change(current.data as T),
        });
      }
    },
  };
  return { snapshots, saved, savedPresets, identity, save };
}

type Readings = Parameters<typeof makeSignIn>[0];

function makeSignIn(reading: Awaited<ReturnType<SignInReader["read"]>>) {
  return { read: vi.fn(async () => reading) } satisfies SignInReader;
}

function setup(
  options: {
    queries?: Partial<RoundQueries>;
    saved?: TargetFaceRecord[] | null;
    presets?: Presets | null;
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
  const memory = memorySnapshots({
    targetFaces: options.saved,
    presets: options.presets,
  });
  const queries: RoundQueries = {
    roundDetail: vi.fn(async () =>
      okResponse({ round: serverRound, targetFaces: [] }),
    ),
    roundDetails: vi.fn(async () =>
      okResponse({ rounds: [serverRound], targetFaces: [] }),
    ),
    targetFaces: vi.fn(async () => okResponse<TargetFaceRecord[]>([])),
    presets: vi.fn(async () => okResponse<PresetRecord[]>([])),
    roundsList: vi.fn(async () => okResponse<ServerRoundSummary[]>([])),
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
      delete: async () => {
        throw new Error("使わない");
      },
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

function presetRecord(
  id: string,
  ownerId: string | null,
  overrides: Partial<PresetRecord> = {},
): PresetRecord {
  return {
    id,
    name: id,
    format: "outdoor",
    bow_type: "recurve",
    owner_id: ownerId,
    created_at: "2026-09-01T00:00:00Z",
    preset_distances: [],
    ...overrides,
  };
}

describe("fetchPresets", () => {
  const savedPresets: Presets = {
    personal: [presetRecord("saved-personal", "user-1")],
    global: [presetRecord("saved-global", null)],
  };
  const presetIds = (data: Presets) =>
    [...data.personal, ...data.global].map((p) => p.id);

  it("取得できたら、個人と公式に振り分けて構成の順に並べたokを返す", async () => {
    // Given
    const { fetching } = setup({
      queries: {
        presets: vi.fn(async () =>
          okResponse([
            presetRecord("global-field", null, { format: "field" }),
            presetRecord("personal-indoor", "user-1", { format: "indoor" }),
            presetRecord("global-outdoor", null),
            presetRecord("personal-outdoor", "user-1"),
          ]),
        ),
      },
    });

    // When
    const result = await fetching.fetchPresets();

    // Then
    expect(
      result.status === "ok" && result.data.personal.map((p) => p.id),
    ).toEqual(["personal-outdoor", "personal-indoor"]);
    expect(
      result.status === "ok" && result.data.global.map((p) => p.id),
    ).toEqual(["global-outdoor", "global-field"]);
  });

  it("0件でも、個人・公式ともに空のokを返す", async () => {
    // Given
    const { fetching } = setup();

    // When
    const result = await fetching.fetchPresets();

    // Then
    expect(result).toEqual({
      status: "ok",
      data: { personal: [], global: [] },
    });
  });

  it("確かめた利用者のIDで問い合わせ、問い合わせの前に認証を読み直さない", async () => {
    // Given
    const { fetching, queries, signIn } = setup();

    // When
    const result = await fetching.fetchPresets();

    // Then
    expect(result.status).toBe("ok");
    expect(queries.presets).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(signIn.read).toHaveBeenCalledTimes(1);
  });

  it("okの結果を、問い合わせに使った利用者のキーへ、取得の開始時刻で保存する", async () => {
    // Given
    const { fetching, save } = setup({
      queries: {
        presets: vi.fn(async () =>
          okResponse([presetRecord("p1", "user-1"), presetRecord("g1", null)]),
        ),
      },
    });

    // When
    await fetching.fetchPresets();

    // Then
    expect(save).toHaveBeenCalledWith(
      "presets",
      "user-1",
      {
        personal: [expect.objectContaining({ id: "p1" })],
        global: [expect.objectContaining({ id: "g1" })],
      },
      1000,
    );
  });

  it("取得できたときは、保存済みがあっても最新で上書きして返す", async () => {
    // Given
    const { fetching, savedPresets: saved } = setup({
      presets: savedPresets,
      queries: {
        presets: vi.fn(async () => okResponse([presetRecord("fresh", null)])),
      },
    });

    // When
    const result = await fetching.fetchPresets();

    // Then
    expect(result.status === "ok" && presetIds(result.data)).toEqual(["fresh"]);
    expect(presetIds(saved.get("user-1")?.data as Presets)).toEqual(["fresh"]);
  });

  it.each<[string, { offline: boolean }, ResponseLike<PresetRecord[]>, number]>(
    [
      [
        "オフライン",
        { offline: true },
        { data: null, error: null, status: 0 },
        0,
      ],
      [
        "通信失敗",
        { offline: false },
        { data: null, error: null, status: 0 },
        1,
      ],
      [
        "サーバーエラー",
        { offline: false },
        { data: null, error: { message: "x" }, status: 500 },
        1,
      ],
    ],
  )(
    "%sのとき、保存済みのプリセットがあればその値のokを返す(的の保存済みだけでは返さない)",
    async (_name, conditions, response, queried) => {
      // Given
      const withSaved = setup({
        ...conditions,
        presets: savedPresets,
        queries: { presets: vi.fn(async () => response) },
      });
      const onlyFaces = setup({
        ...conditions,
        saved: [face("saved", null)],
        queries: { presets: vi.fn(async () => response) },
      });

      // When
      const result = await withSaved.fetching.fetchPresets();
      const withoutPresets = await onlyFaces.fetching.fetchPresets();

      // Then
      expect(result).toEqual({ status: "ok", data: savedPresets });
      expect(withoutPresets.status).not.toBe("ok");
      expect(withSaved.queries.presets).toHaveBeenCalledTimes(queried);
    },
  );

  it("通信できないとき、保存済みが無ければ、問い合わせずにofflineを返す", async () => {
    // Given
    const { fetching, queries } = setup({ offline: true });

    // When
    const result = await fetching.fetchPresets();

    // Then
    expect(result).toEqual({ status: "offline" });
    expect(queries.presets).not.toHaveBeenCalled();
  });

  it("通信失敗(状態0)は、保存済みが無ければ、原因を断定せずerrorを返す", async () => {
    // Given
    const { fetching } = setup({
      queries: {
        presets: vi.fn(async () => ({ data: null, error: null, status: 0 })),
      },
    });

    // When
    const result = await fetching.fetchPresets();

    // Then
    expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
  });

  it("サーバーエラーは、保存済みが無ければerrorを返す", async () => {
    // Given
    const { fetching } = setup({
      queries: {
        presets: vi.fn(async () => ({
          data: null,
          error: { message: "boom" },
          status: 500,
        })),
      },
    });

    // When
    const result = await fetching.fetchPresets();

    // Then
    expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
  });

  it("サインインしていないとき、問い合わせずに、読み取りの文言でerrorを返す", async () => {
    // Given
    const { fetching, queries } = setup({
      signIn: { status: "unauthenticated", message: AUTH_REQUIRED_MESSAGE },
    });

    // When
    const result = await fetching.fetchPresets();

    // Then
    expect(result).toEqual({ status: "error", message: AUTH_REQUIRED_MESSAGE });
    expect(queries.presets).not.toHaveBeenCalled();
  });

  it("保存済みがあると、FALLBACK_WAIT_MSで終わらない取得を待たず保存済みを返す", async () => {
    // Given
    const { fetching, clock } = setup({
      presets: savedPresets,
      queries: { presets: () => new Promise<never>(() => {}) },
    });
    const pending = fetching.fetchPresets();

    // When
    await clock.advanceAsync(FALLBACK_WAIT_MS);

    // Then
    await expect(pending).resolves.toEqual({
      status: "ok",
      data: savedPresets,
    });
  });

  it("保存済みが無いと、FALLBACK_WAIT_MSでは返らず、FETCH_TIMEOUT_MSでerrorになる", async () => {
    // Given
    const { fetching, clock } = setup({
      queries: { presets: () => new Promise<never>(() => {}) },
    });
    let settled = false;
    const pending = fetching.fetchPresets().finally(() => {
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
    const {
      fetching,
      clock,
      savedPresets: saved,
      identity,
    } = setup({
      presets: savedPresets,
      queries: {
        presets: vi.fn(
          () =>
            new Promise<ResponseLike<PresetRecord[]>>((resolve) => {
              clock.after(3000, () =>
                resolve(okResponse([presetRecord("late", null)])),
              );
            }),
        ),
      },
    });
    const pending = fetching.fetchPresets();
    await clock.advanceAsync(FALLBACK_WAIT_MS);
    const shown = await pending;
    identity.userId = "user-2";

    // When
    await clock.advanceAsync(3000);

    // Then
    expect(shown).toEqual({ status: "ok", data: savedPresets });
    expect(presetIds(saved.get("user-1")?.data as Presets)).toEqual(["late"]);
    expect(saved.has("user-2")).toBe(false);
  });

  it("時間切れの後に届いた結果がok以外なら、保存済みは変わらない", async () => {
    // Given
    const {
      fetching,
      clock,
      savedPresets: saved,
    } = setup({
      presets: savedPresets,
      queries: {
        presets: vi.fn(
          () =>
            new Promise<ResponseLike<PresetRecord[]>>((resolve) => {
              clock.after(3000, () =>
                resolve({ data: null, error: { message: "x" }, status: 500 }),
              );
            }),
        ),
      },
    });
    const pending = fetching.fetchPresets();
    await clock.advanceAsync(FALLBACK_WAIT_MS);
    await pending;

    // When
    await clock.advanceAsync(3000);

    // Then
    expect(saved.get("user-1")?.data).toEqual(savedPresets);
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

describe("fetchRoundsList", () => {
  const summary = (
    id: string,
    shots: { score_int: number; disabled: boolean }[],
  ): ServerRoundSummary => ({
    id,
    name: `ラウンド${id}`,
    roundDate: "2026-09-15",
    distances: [{ disabled: false, shots }],
  });

  it("取得できたら、各行を合計点を含む一覧の1件にして、問い合わせの返した順のまま返す", async () => {
    // Given
    const { fetching } = setup({
      queries: {
        roundsList: async () =>
          okResponse([
            summary("round-2", [{ score_int: 10, disabled: false }]),
            summary("round-1", [
              { score_int: 9, disabled: false },
              { score_int: 8, disabled: true },
            ]),
          ]),
      },
    });

    // When
    const result = await fetching.fetchRoundsList();

    // Then
    expect(result).toEqual({
      status: "ok",
      data: [
        {
          id: "round-2",
          name: "ラウンドround-2",
          roundDate: "2026-09-15",
          total: 10,
        },
        {
          id: "round-1",
          name: "ラウンドround-1",
          roundDate: "2026-09-15",
          total: 9,
        },
      ],
    });
  });

  it.each([
    ["0件", okResponse<ServerRoundSummary[]>([])],
    ["応答のdataがnull", okResponse(null as unknown as ServerRoundSummary[])],
  ])("%sのとき、not-foundではなく空配列のokを返す", async (_name, response) => {
    // Given
    const { fetching } = setup({
      queries: { roundsList: async () => response },
    });

    // When
    const result = await fetching.fetchRoundsList();

    // Then
    expect(result).toEqual({ status: "ok", data: [] });
  });

  it("通信できないとき、原因を断定せずerrorを返す", async () => {
    // Given
    const { fetching } = setup({
      queries: {
        roundsList: async () => ({ data: null, error: null, status: 0 }),
      },
    });

    // When
    const result = await fetching.fetchRoundsList();

    // Then
    expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
  });

  it("取得がエラーのとき、errorを返し、一覧は返さない", async () => {
    // Given
    const { fetching } = setup({
      queries: {
        roundsList: async () => ({
          data: null,
          error: { message: "query failed" },
          status: 500,
        }),
      },
    });

    // When
    const result = await fetching.fetchRoundsList();

    // Then
    expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
  });

  it("サインインしていないとき、roundsListを呼ばず、サインインが必要なerrorを返す", async () => {
    // Given
    const { fetching, queries } = setup({
      signIn: { status: "unauthenticated", message: AUTH_REQUIRED_MESSAGE },
    });

    // When
    const result = await fetching.fetchRoundsList();

    // Then
    expect(result).toEqual({
      status: "error",
      message: AUTH_REQUIRED_MESSAGE,
    });
    expect(queries.roundsList).not.toHaveBeenCalled();
  });

  it("終わらない取得は、FETCH_TIMEOUT_MSでerrorにし、FALLBACK_WAIT_MSでは返らない", async () => {
    // Given
    const { fetching, clock } = setup({
      queries: { roundsList: () => new Promise<never>(() => {}) },
    });
    let settled = false;
    const pending = fetching.fetchRoundsList().finally(() => {
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
});
