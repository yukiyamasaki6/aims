import { describe, expect, it, vi } from "vitest";
import type { SessionReader } from "@/features/auth";
import { createFakeSessionReader } from "@/features/auth/application/session-reader-test-helpers";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import { FETCH_TIMEOUT_MS } from "../domain/fetch-wait";
import type { QueryOutcome } from "../domain/query-outcome";
import { createContentFetcher } from "./content-fetcher";

const okResponse: QueryOutcome<{ id: string }> = {
  status: "ok",
  data: { id: "a" },
};
const authRejected: QueryOutcome<{ id: string }> = { status: "auth-rejected" };
const commFailure: QueryOutcome<{ id: string }> = { status: "comm-failure" };
const unknown = { status: "unknown" } as const;
const authenticated = { status: "authenticated", userId: "u1" } as const;
const unauthenticated = { status: "unauthenticated" } as const;

type Reading = Awaited<ReturnType<SessionReader["readSession"]>>;

// 切断の状態を、テストから動かせる通信の可否。
function makeConnectivity(offline = false) {
  const state = { offline };
  const connectivity: Connectivity = {
    isOffline: () => state.offline,
    onOnline: () => () => {},
  };
  return {
    connectivity,
    state,
    goOffline() {
      state.offline = true;
    },
  };
}

function setup(
  options: {
    readings?: (Reading | (() => Promise<Reading>))[];
    offline?: boolean;
  } = {},
) {
  const clock = createManualClock();
  const network = makeConnectivity(options.offline);
  const { sessionReader, readSession: read } = createFakeSessionReader(
    options.readings ?? [authenticated],
  );
  const fetcher = createContentFetcher({
    sessionReader,
    connectivity: network.connectivity,
    clock,
  });
  return { fetcher, clock, network, read };
}

describe("fetchContent", () => {
  describe("正常系", () => {
    it("認証済みのとき、確かめたセッションでクエリし、結果を判定して返す", async () => {
      // Given
      const { fetcher } = setup();
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "ok", data: { id: "a" } });
      expect(run).toHaveBeenCalledExactlyOnceWith({ userId: "u1" });
    });

    it("クエリが認証の拒否で返ると、更新を強制して確かめ、新しいセッションで取り直した結果を返す", async () => {
      // Given
      const { fetcher, read } = setup({
        readings: [
          authenticated,
          { status: "authenticated", userId: "u1-refreshed" },
        ],
      });
      const run = vi
        .fn()
        .mockResolvedValueOnce(authRejected)
        .mockResolvedValueOnce(okResponse);

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "ok", data: { id: "a" } });
      expect(read).toHaveBeenLastCalledWith({ refresh: true });
      expect(run).toHaveBeenLastCalledWith({ userId: "u1-refreshed" });
    });

    it("クエリがnot-foundで返ると、not-foundを返す", async () => {
      // Given
      const { fetcher } = setup();
      const run = async (): Promise<QueryOutcome<{ id: string }>> => ({
        status: "not-found",
      });

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "not-found" });
    });

    it("クエリがcomm-failureを返すと、オンラインなら原因を断定せずerrorにする", async () => {
      // Given
      const { fetcher } = setup();
      const run = async () => commFailure;

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "error", reason: "failed" });
    });

    it("同じ取得器で続けて取得すると、取得のたびにサインインしている利用者を読み直す", async () => {
      // Given
      const { fetcher } = setup({
        readings: [
          { status: "authenticated", userId: "user-a" },
          { status: "authenticated", userId: "user-b" },
        ],
      });
      const run = vi.fn(async () => okResponse);

      // When
      await fetcher.fetchContent(run);
      await fetcher.fetchContent(run);

      // Then
      expect(run).toHaveBeenNthCalledWith(1, { userId: "user-a" });
      expect(run).toHaveBeenNthCalledWith(2, { userId: "user-b" });
    });
  });

  describe("異常系", () => {
    it("オフラインのとき、サインインの読み取りもクエリも呼ばずofflineにする", async () => {
      // Given
      const { fetcher, read } = setup({ offline: true });
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "offline" });
      expect(read).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    });

    it("未認証のとき、クエリを実行せず、約束の文言のerrorにする", async () => {
      // Given
      const { fetcher } = setup({ readings: [unauthenticated] });
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({
        status: "error",
        reason: "unauthenticated",
      });
      expect(run).not.toHaveBeenCalled();
    });

    it("続けて取得し、2回目に未認証になると、2回目はクエリを実行せずサインインが必要なerrorにする", async () => {
      // Given
      const { fetcher } = setup({ readings: [authenticated, unauthenticated] });
      const run = vi.fn(async () => okResponse);
      const first = await fetcher.fetchContent(run);

      // When
      const second = await fetcher.fetchContent(run);

      // Then
      expect(first).toEqual({ status: "ok", data: { id: "a" } });
      expect(second).toEqual({
        status: "error",
        reason: "unauthenticated",
      });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("サインインの状態を確かめられないとき、クエリを実行せずerrorにする", async () => {
      // Given
      const { fetcher } = setup({ readings: [unknown] });
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "error", reason: "failed" });
      expect(run).not.toHaveBeenCalled();
    });

    it("クエリがauth-rejectedで返り、更新で未認証と分かると、サインインが必要なerrorにする", async () => {
      // Given
      const { fetcher } = setup({ readings: [authenticated, unauthenticated] });
      const run = vi.fn(async () => authRejected);

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({
        status: "error",
        reason: "unauthenticated",
      });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("クエリがauth-rejectedで返り、更新で確かめられないと、errorにする", async () => {
      // Given
      const { fetcher } = setup({
        readings: [authenticated, unknown],
      });
      const run = vi.fn(async () => authRejected);

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "error", reason: "failed" });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("更新で確かめた後の取り直しも認証の拒否で返ると、サインインを求めずerrorにし、3回目は取り直さない", async () => {
      // Given
      const { fetcher, read } = setup();
      const run = vi.fn(async () => authRejected);

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "error", reason: "failed" });
      expect(run).toHaveBeenCalledTimes(2);
      expect(read).toHaveBeenCalledTimes(2);
    });

    it("更新後の取り直しがcomm-failureのとき、errorにする", async () => {
      // Given
      const { fetcher } = setup();
      const run = vi
        .fn()
        .mockResolvedValueOnce(authRejected)
        .mockResolvedValueOnce(commFailure);

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "error", reason: "failed" });
    });

    it("サインインの読み取りの待機中に切断になっても、読み取りを待ち続け、打ち切りでofflineにする", async () => {
      // Given
      const { fetcher, network, clock } = setup({
        readings: [() => new Promise<Reading>(() => {})],
      });
      const run = vi.fn(async () => okResponse);
      const pending = fetcher.fetchContent(run);
      network.goOffline();

      // When
      await clock.advanceAsync(FETCH_TIMEOUT_MS - 1);
      const early = await Promise.race([pending, Promise.resolve("waiting")]);
      await clock.advanceAsync(1);

      // Then
      expect(early).toBe("waiting");
      await expect(pending).resolves.toEqual({ status: "offline" });
      expect(run).not.toHaveBeenCalled();
    });

    it("サインインの読み取りが時間内に終わらないと(onLineがtrueのまま通信できない場合)、errorにする", async () => {
      // Given
      const { fetcher, clock } = setup({
        readings: [() => new Promise<Reading>(() => {})],
      });
      const pending = fetcher.fetchContent(async () => okResponse);

      // When
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      await expect(pending).resolves.toEqual({
        status: "error",
        reason: "failed",
      });
    });

    it("クエリが時間内に終わらないときも、errorにする", async () => {
      // Given
      const { fetcher, clock } = setup();
      const pending = fetcher.fetchContent(() => new Promise<never>(() => {}));

      // When
      await clock.advanceAsync(FETCH_TIMEOUT_MS - 1);
      const early = await Promise.race([pending, Promise.resolve("running")]);
      await clock.advanceAsync(1);

      // Then
      expect(early).toBe("running");
      await expect(pending).resolves.toEqual({
        status: "error",
        reason: "failed",
      });
    });

    it.each([
      ["クエリがcomm-failureを返す", async () => commFailure],
      [
        "クエリが例外を投げる",
        async () => {
          throw new Error("boom");
        },
      ],
    ])(
      "取得中に回線が落ちて切断になり、%sと、offlineにする",
      async (_name, query) => {
        // Given
        const { fetcher, network } = setup();
        const run = async () => {
          network.state.offline = true;
          return query();
        };

        // When
        const result = await fetcher.fetchContent(run);

        // Then
        expect(result).toEqual({ status: "offline" });
      },
    );

    it("取得中に回線が落ちて切断になり、クエリが時間内に終わらないと、offlineにする", async () => {
      // Given
      const { fetcher, network, clock } = setup();
      const pending = fetcher.fetchContent(() => {
        network.state.offline = true;
        return new Promise<never>(() => {});
      });

      // When
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      await expect(pending).resolves.toEqual({ status: "offline" });
    });

    it("サインインの読み取りが確かめられなかった時点で切断なら、offlineにする", async () => {
      // Given
      const network = makeConnectivity();
      const fetcher = createContentFetcher({
        sessionReader: createFakeSessionReader([
          async () => {
            network.state.offline = true;
            return unknown;
          },
        ]).sessionReader,
        connectivity: network.connectivity,
        clock: createManualClock(),
      });

      // When
      const result = await fetcher.fetchContent(async () => okResponse);

      // Then
      expect(result).toEqual({ status: "offline" });
    });

    it("切断でも、HTTP応答のあるエラー(failed)はerrorのままにする", async () => {
      // Given
      const { fetcher, network } = setup();
      const run = async (): Promise<QueryOutcome<{ id: string }>> => {
        network.state.offline = true;
        return { status: "failed" } as const;
      };

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "error", reason: "failed" });
    });

    it("時間内に終われば、時間切れの登録を残さない", async () => {
      // Given
      const { fetcher, clock } = setup();

      // When
      const result = await fetcher.fetchContent(async () => okResponse);

      // Then
      expect(result).toEqual({ status: "ok", data: { id: "a" } });
      expect(clock.pendingCount()).toBe(0);
    });

    it("クエリが例外を投げると、固定文のerrorにする", async () => {
      // Given
      const { fetcher } = setup();
      const run = async () => {
        throw new Error("internal detail");
      };

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "error", reason: "failed" });
    });
  });

  describe("FETCH_TIMEOUT_MSでの打ち切り", () => {
    // 取得の終わる時刻を、手動の時計から決められるクエリで模す。
    function slowQuery(
      clock: ReturnType<typeof createManualClock>,
      delayMs: number,
    ) {
      return () =>
        new Promise<QueryOutcome<{ id: string }>>((resolve) => {
          clock.after(delayMs, () => resolve(okResponse));
        });
    }

    it("取得が終わらないまま上限に達すると、遅れて届く結果を待たずにerrorを返す", async () => {
      // Given
      const { fetcher, clock } = setup();
      const pending = fetcher.fetchContent(
        slowQuery(clock, FETCH_TIMEOUT_MS + 5_000),
      );

      // When
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      await expect(pending).resolves.toEqual({
        status: "error",
        reason: "failed",
      });
    });

    it("取得中に切断になっていれば、時間切れはofflineを返す", async () => {
      // Given
      const { fetcher, clock, network } = setup();
      const pending = fetcher.fetchContent(
        slowQuery(clock, FETCH_TIMEOUT_MS + 5_000),
      );
      network.state.offline = true;

      // When
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      await expect(pending).resolves.toEqual({ status: "offline" });
    });
  });
});
