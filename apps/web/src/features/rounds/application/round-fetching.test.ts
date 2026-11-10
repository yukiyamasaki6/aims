import { describe, expect, it, vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import { createFakeSessionReader } from "@/features/auth/application/session-reader-test-helpers";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import { createFakeConnectivity } from "@/lib/connectivity/fake-connectivity-test-helpers";
import type {
  DatabaseGateway,
  DbResponse,
} from "@/lib/supabase/contract/database";
import type { FetchResult } from "../domain/fetch-status";
import type { PresetRecord, Presets } from "../domain/preset";
import type { QueryFailure, QueryOutcome } from "../domain/query-outcome";
import type { ServerRoundSummary } from "../domain/round-list";
import type { ServerRound } from "../domain/round-tables";
import type { TargetFaceRecord } from "../domain/target-face";
import { createRoundQueries } from "../infrastructure/round-queries";
import type { RoundsDbSchema } from "../infrastructure/rounds-db-schema";
import { createContentFetcher } from "./content-fetcher";
import type { ReferenceKind, ReferenceSnapshots } from "./reference-snapshots";
import { createRoundFetching, type RoundQueries } from "./round-fetching";

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
      shots: [{ ...shotA, revision: 5, disabled_at: null }],
    },
  ],
};

const okResponse = <T>(data: T): QueryOutcome<T> => ({ status: "ok", data });
const commFailure: QueryFailure = { status: "comm-failure" };
const failed: QueryFailure = { status: "failed" };
const notFound: QueryFailure = { status: "not-found" };

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

type Readings = Awaited<ReturnType<SessionReader["readSession"]>>;

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
  const connectivity = createFakeConnectivity(options.offline);
  const { sessionReader, readSession } = createFakeSessionReader(
    options.signIn && [options.signIn],
  );
  const content = createContentFetcher({ sessionReader, connectivity, clock });
  const memory = memorySnapshots({
    targetFaces: options.saved,
    presets: options.presets,
  });
  const queries: RoundQueries = {
    roundDetail: vi.fn(async () => okResponse(serverRound)),
    roundDetails: vi.fn(async () =>
      okResponse({ rounds: [serverRound], targetFaces: [] }),
    ),
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
  return { fetching, queries, clock, readSession, ...memory };
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
        base: {
          tables: {
            round: {
              config: {
                name: "午前練習",
                roundDate: "2026-09-15",
                format: "outdoor",
                bowType: "recurve",
              },
              status: "completed",
              disabled: false,
            },
            distances: [{ ...distanceA, disabled: false }],
            shots: [{ ...shotA, disabled: false }],
          },
          revisions: {
            round: 3,
            distances: { "d-a": 4 },
            shots: { "s-a": 5 },
          },
        },
        startedAt: 1000,
        userId: "user-1",
      },
    });
  });

  it("ラウンドだけを問い合わせ、的は取得も保存もしない", async () => {
    // Given
    const { fetching, queries, save } = setup();

    // When
    await fetching.fetchRoundDetail("round-1");

    // Then
    expect(queries.roundDetail).toHaveBeenCalledExactlyOnceWith("round-1");
    expect(save).not.toHaveBeenCalled();
  });

  it("ラウンドが見つからないときは、not-foundを返し、的は保存しない", async () => {
    // Given
    const { fetching, save } = setup({
      queries: {
        roundDetail: vi.fn(async () => notFound),
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
      signIn: { status: "unauthenticated" },
    });

    // When
    const result = await fetching.fetchRoundDetail("round-1");

    // Then
    expect(result).toEqual({ status: "error", reason: "unauthenticated" });
    expect(queries.roundDetail).not.toHaveBeenCalled();
  });

  it("問い合わせの失敗(サーバーエラー、通信失敗)は取得エラーにする", async () => {
    // Given
    const serverError = setup({
      queries: {
        roundDetail: vi.fn(async () => failed),
      },
    });
    const commError = setup({
      queries: {
        roundDetail: vi.fn(async () => commFailure),
      },
    });

    // When
    const first = await serverError.fetching.fetchRoundDetail("r");
    const second = await commError.fetching.fetchRoundDetail("r");

    // Then
    expect(first).toEqual({ status: "error", reason: "failed" });
    expect(second).toEqual({ status: "error", reason: "failed" });
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
        base: {
          tables: { distances: [{ ...distanceA, disabled: false }], shots: [] },
          revisions: { shots: { "s-a": 5 } },
        },
      },
    });
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
    const { fetching, queries, readSession } = setup();

    // When
    const result = await fetching.fetchPresets();

    // Then
    expect(result.status).toBe("ok");
    expect(queries.presets).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(readSession).toHaveBeenCalledTimes(1);
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

  it.each<
    [
      string,
      { offline: boolean },
      QueryOutcome<PresetRecord[]>,
      FetchResult<Presets>,
    ]
  >([
    ["オフライン", { offline: true }, commFailure, { status: "offline" }],
    [
      "通信失敗",
      { offline: false },
      commFailure,
      { status: "error", reason: "failed" },
    ],
    [
      "サーバーエラー",
      { offline: false },
      failed,
      { status: "error", reason: "failed" },
    ],
  ])(
    "%sのとき、保存済みのプリセットがあっても代わりにせず、結果をそのまま返す",
    async (_name, conditions, response, expected) => {
      // Given
      const { fetching } = setup({
        ...conditions,
        presets: savedPresets,
        queries: { presets: vi.fn(async () => response) },
      });

      // When
      const result = await fetching.fetchPresets();

      // Then
      expect(result).toEqual(expected);
    },
  );

  it("通信できないとき、問い合わせずにofflineを返す", async () => {
    // Given
    const { fetching, queries } = setup({ offline: true });

    // When
    const result = await fetching.fetchPresets();

    // Then
    expect(result).toEqual({ status: "offline" });
    expect(queries.presets).not.toHaveBeenCalled();
  });

  it("通信失敗(状態0)は、原因を断定せずerrorを返す", async () => {
    // Given
    const { fetching } = setup({
      queries: {
        presets: vi.fn(async () => commFailure),
      },
    });

    // When
    const result = await fetching.fetchPresets();

    // Then
    expect(result).toEqual({ status: "error", reason: "failed" });
  });

  it("サーバーエラーは、errorを返す", async () => {
    // Given
    const { fetching } = setup({
      queries: {
        presets: vi.fn(async () => failed),
      },
    });

    // When
    const result = await fetching.fetchPresets();

    // Then
    expect(result).toEqual({ status: "error", reason: "failed" });
  });

  it("サインインしていないとき、問い合わせずに、読み取りの文言でerrorを返す", async () => {
    // Given
    const { fetching, queries } = setup({
      signIn: { status: "unauthenticated" },
    });

    // When
    const result = await fetching.fetchPresets();

    // Then
    expect(result).toEqual({ status: "error", reason: "unauthenticated" });
    expect(queries.presets).not.toHaveBeenCalled();
  });

  it("savedPresetsは、今の利用者の保存済みを返し、無ければnullを返す", () => {
    // Given
    const { fetching, identity } = setup({ presets: savedPresets });

    // When
    const own = fetching.savedPresets();
    identity.userId = "user-2";
    const other = fetching.savedPresets();

    // Then
    expect(own).toEqual(savedPresets);
    expect(other).toBeNull();
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
      base: {
        tables: { round: { status: "in_progress" } },
        revisions: { round: 3 },
      },
      userId: "user-1",
      startedAt: result.data.startedAt,
    });
    expect(result.data.startedAt).toBe(1000);
    expect(idsOf(saved.get("user-1")?.data)).toEqual(["g"]);
  });

  it("サインインが必要なときは、取得せずに約束の文言のerrorを返す", async () => {
    // Given
    const { fetching, queries } = setup({
      signIn: { status: "unauthenticated" },
    });

    // When
    const result = await fetching.fetchRoundDetails([]);

    // Then
    expect(result).toEqual({ status: "error", reason: "unauthenticated" });
    expect(queries.roundDetails).not.toHaveBeenCalled();
  });

  it("取得に失敗したときは、そのまま返し、的を保存しない", async () => {
    // Given
    const { fetching, save } = setup({
      queries: {
        roundDetails: vi.fn(async () => commFailure),
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
    round_date: "2026-09-15",
    distances: [
      {
        disabled_at: null,
        shots: shots.map(({ score_int, disabled }) => ({
          score_int,
          disabled_at: disabled ? "2026-09-15T10:00:00Z" : null,
        })),
      },
    ],
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

  it("0件のとき、not-foundではなく空配列のokを返す", async () => {
    // Given
    const { fetching } = setup({
      queries: {
        roundsList: async () => okResponse<ServerRoundSummary[]>([]),
      },
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
        roundsList: async () => commFailure,
      },
    });

    // When
    const result = await fetching.fetchRoundsList();

    // Then
    expect(result).toEqual({ status: "error", reason: "failed" });
  });

  it("取得がエラーのとき、errorを返し、一覧は返さない", async () => {
    // Given
    const { fetching } = setup({
      queries: {
        roundsList: async () => failed,
      },
    });

    // When
    const result = await fetching.fetchRoundsList();

    // Then
    expect(result).toEqual({ status: "error", reason: "failed" });
  });

  it("サインインしていないとき、roundsListを呼ばず、サインインが必要なerrorを返す", async () => {
    // Given
    const { fetching, queries } = setup({
      signIn: { status: "unauthenticated" },
    });

    // When
    const result = await fetching.fetchRoundsList();

    // Then
    expect(result).toEqual({
      status: "error",
      reason: "unauthenticated",
    });
    expect(queries.roundsList).not.toHaveBeenCalled();
  });
});
