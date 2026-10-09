import {
  AuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/supabase";
import type { FetchedRoundDetail } from "./fetch-round-detail";
import { commitRoundDetails, refreshRoundBases } from "./refresh-round-bases";

// 取得と端末の組は別のテストで確かめるため、境界としてモックする。
const deps = vi.hoisted(() => ({
  fetchRoundDetails: vi.fn(),
  retainedRoundIds: vi.fn(),
  commit: vi.fn(),
  getUserId: vi.fn(),
}));
vi.mock("./fetch-round-detail", () => ({
  fetchRoundDetails: deps.fetchRoundDetails,
}));
vi.mock("../_shared/round-op-log", () => ({
  roundOpLog: {
    retainedRoundIds: deps.retainedRoundIds,
    commit: deps.commit,
  },
}));
vi.mock("../_shared/round-op-hub", () => ({
  roundOpHub: { getUserId: deps.getUserId },
}));

function supabaseOf(userId: string | null) {
  return {
    auth: {
      getSession: async () => ({
        data: { session: userId ? { user: { id: userId } } : null },
      }),
    },
  } as unknown as SupabaseClient<Database>;
}

// セッションの読み取りが通信失敗で、認証を確認できない。
function supabaseWithFetchFailure() {
  return {
    auth: {
      getSession: async () => ({
        data: { session: null },
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      }),
    },
  } as unknown as SupabaseClient<Database>;
}

function detail(status: "in_progress" | "completed"): FetchedRoundDetail {
  return {
    roundConfig: {
      name: "午前練習",
      roundDate: "2026-09-15",
      format: "outdoor",
      bowType: "recurve",
    },
    status,
    distances: [],
    shots: [],
    targetFaces: [],
    revisions: { round: 3, distances: {}, shots: {} },
    startedAt: 100,
    userId: "user-1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  deps.getUserId.mockReturnValue("user-1");
  deps.retainedRoundIds.mockResolvedValue([]);
  deps.commit.mockResolvedValue({ base: undefined, entries: [] });
});

describe("refreshRoundBases", () => {
  it("保持するラウンドの取得に、端末が保持するラウンドのIDを渡し、取得したラウンドごとにベースを反映して成功を返す", async () => {
    // Given: 端末が2件を保持し、取得は1件(入力中のラウンド)と、保持の1件を返す
    deps.retainedRoundIds.mockResolvedValue(["kept"]);
    deps.fetchRoundDetails.mockResolvedValue({
      status: "ok",
      data: {
        rounds: new Map([
          ["in-progress", detail("in_progress")],
          ["kept", detail("completed")],
        ]),
        startedAt: 100,
        userId: "user-1",
      },
    });

    // When
    const result = await refreshRoundBases(supabaseOf("user-1"));

    // Then
    expect(result).toBe(true);
    expect(deps.fetchRoundDetails).toHaveBeenCalledWith(expect.anything(), [
      "kept",
    ]);
    expect(deps.commit).toHaveBeenCalledTimes(2);
    expect(deps.commit).toHaveBeenCalledWith(
      "in-progress",
      expect.objectContaining({
        revisions: { round: 3, distances: {}, shots: {} },
        tables: expect.objectContaining({
          round: expect.objectContaining({ status: "in_progress" }),
        }),
      }),
      100,
      "user-1",
    );
  });

  it("取得が返さなかった保持のラウンドは、削除の印として反映する", async () => {
    deps.retainedRoundIds.mockResolvedValue(["gone", "kept"]);
    deps.fetchRoundDetails.mockResolvedValue({
      status: "ok",
      data: {
        rounds: new Map([["kept", detail("in_progress")]]),
        startedAt: 100,
        userId: "user-1",
      },
    });

    await refreshRoundBases(supabaseOf("user-1"));

    expect(deps.commit).toHaveBeenCalledWith("gone", null, 100, "user-1");
  });

  it("全ての反映を待ってから成功を返す", async () => {
    deps.fetchRoundDetails.mockResolvedValue({
      status: "ok",
      data: {
        rounds: new Map([["r", detail("in_progress")]]),
        startedAt: 100,
        userId: "user-1",
      },
    });
    let finish: () => void = () => {};
    deps.commit.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    let done = false;

    const refreshing = refreshRoundBases(supabaseOf("user-1")).then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(done).toBe(false);
    finish();
    await refreshing;

    expect(done).toBe(true);
  });

  it("セッションの確認が通信失敗で不明なときは、取得せずに失敗を返す", async () => {
    // Given
    const supabase = supabaseWithFetchFailure();

    // When
    const result = await refreshRoundBases(supabase);

    // Then
    expect(result).toBe(false);
    expect(deps.fetchRoundDetails).not.toHaveBeenCalled();
  });

  it.each([
    ["セッションが無い", null, "user-1"],
    ["端末の識別と違うユーザー", "user-2", "user-1"],
  ])("%sときは、取得せずに失敗を返す", async (_name, sessionUser, hubUser) => {
    deps.getUserId.mockReturnValue(hubUser);

    expect(await refreshRoundBases(supabaseOf(sessionUser))).toBe(false);
    expect(deps.fetchRoundDetails).not.toHaveBeenCalled();
  });

  it.each([
    ["offline", { status: "offline" }],
    ["error", { status: "error", message: "x" }],
  ])("取得が%sのときは、何も反映せずに失敗を返す", async (_name, failure) => {
    deps.retainedRoundIds.mockResolvedValue(["kept"]);
    deps.fetchRoundDetails.mockResolvedValue(failure);

    expect(await refreshRoundBases(supabaseOf("user-1"))).toBe(false);
    expect(deps.commit).not.toHaveBeenCalled();
  });
});

describe("commitRoundDetails", () => {
  it("返ったラウンドはベースとして、返らなかった保持のラウンドは削除の印として反映し、全て待つ", async () => {
    let release: () => void = () => {};
    deps.commit.mockImplementation(
      (roundId: string) =>
        new Promise<void>((resolve) => {
          if (roundId === "gone") release = resolve;
          else resolve();
        }),
    );
    let done = false;

    const pending = commitRoundDetails(
      {
        rounds: new Map([["kept", detail("in_progress")]]),
        startedAt: 100,
        userId: "user-1",
      },
      ["gone", "kept"],
    ).then(() => {
      done = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(done).toBe(false);
    release();
    await pending;
    expect(done).toBe(true);
    expect(deps.commit).toHaveBeenCalledWith("gone", null, 100, "user-1");
    expect(deps.commit).toHaveBeenCalledWith(
      "kept",
      expect.objectContaining({
        revisions: { round: 3, distances: {}, shots: {} },
      }),
      100,
      "user-1",
    );
  });
});
