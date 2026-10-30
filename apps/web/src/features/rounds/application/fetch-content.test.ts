import { describe, expect, it, vi } from "vitest";
import { createManualClock } from "@/lib/clock/manual-clock-test-helpers";
import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  FALLBACK_WAIT_MS,
  FETCH_ERROR_MESSAGE,
  FETCH_TIMEOUT_MS,
} from "../domain/fetch-result";
import { createContentFetcher } from "./fetch-content";
import type { SignInReader } from "./sign-in-reader";

const AUTH_REQUIRED_MESSAGE = "サインインが必要です。";

const okResponse = { data: { id: "a" }, error: null, status: 200 };
const unauthorizedResponse = {
  data: null,
  error: { code: "PGRST301", message: "JWT expired" },
  status: 401,
};
const UNREACHABLE_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";
const unknown = { status: "unknown", message: UNREACHABLE_MESSAGE } as const;
const authenticated = { status: "authenticated", userId: "u1" } as const;
const unauthenticated = {
  status: "unauthenticated",
  message: AUTH_REQUIRED_MESSAGE,
} as const;

type Reading = Awaited<ReturnType<SignInReader["read"]>>;

// 切断の状態と通知を、テストから動かせる通信の可否。
function makeConnectivity(offline = false) {
  const state = { offline };
  const offlineListeners = new Set<() => void>();
  const connectivity: Connectivity = {
    isOffline: () => state.offline,
    onOnline: () => () => {},
    onOffline: (listener) => {
      offlineListeners.add(listener);
      return () => offlineListeners.delete(listener);
    },
  };
  return {
    connectivity,
    state,
    offlineListeners,
    goOffline() {
      state.offline = true;
      for (const listener of [...offlineListeners]) listener();
    },
  };
}

// 呼ばれるたびに、渡した読み取りを順に返すサインインの読み手。
function makeSignIn(...readings: (Reading | (() => Promise<Reading>))[]) {
  let index = 0;
  const read = vi.fn(async (_options?: { refresh?: boolean }) => {
    const next = readings[Math.min(index, readings.length - 1)];
    index += 1;
    return typeof next === "function" ? next() : next;
  });
  return { signIn: { read } satisfies SignInReader, read };
}

function setup(
  options: {
    readings?: (Reading | (() => Promise<Reading>))[];
    offline?: boolean;
  } = {},
) {
  const clock = createManualClock();
  const network = makeConnectivity(options.offline);
  const { signIn, read } = makeSignIn(...(options.readings ?? [authenticated]));
  const fetcher = createContentFetcher({
    signIn,
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
        .mockResolvedValueOnce(unauthorizedResponse)
        .mockResolvedValueOnce(okResponse);

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "ok", data: { id: "a" } });
      expect(read).toHaveBeenLastCalledWith({ refresh: true });
      expect(run).toHaveBeenLastCalledWith({ userId: "u1-refreshed" });
    });

    it("nullIsNotFoundを判定へ渡す", async () => {
      // Given
      const { fetcher } = setup();
      const run = async () => ({ data: null, error: null, status: 200 });

      // When
      const result = await fetcher.fetchContent(run, { nullIsNotFound: true });

      // Then
      expect(result).toEqual({ status: "not-found" });
    });

    it("クエリが通信失敗(status 0)を返すと、原因を断定せずerrorにする", async () => {
      // Given
      const { fetcher } = setup();
      const run = async () => ({
        data: null,
        error: { message: "TypeError: Failed to fetch" },
        status: 0,
      });

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
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
        message: AUTH_REQUIRED_MESSAGE,
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
        message: AUTH_REQUIRED_MESSAGE,
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
      expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
      expect(run).not.toHaveBeenCalled();
    });

    it("クエリが認証の拒否で返り、更新で未認証と分かると、サインインが必要なerrorにする", async () => {
      // Given
      const { fetcher } = setup({ readings: [authenticated, unauthenticated] });
      const run = vi.fn(async () => unauthorizedResponse);

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("クエリが認証の拒否で返り、更新で確かめられないと、errorにする", async () => {
      // Given
      const { fetcher } = setup({
        readings: [authenticated, unknown],
      });
      const run = vi.fn(async () => unauthorizedResponse);

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("更新で確かめた後の取り直しも認証の拒否で返ると、サインインを求めずerrorにし、3回目は取り直さない", async () => {
      // Given
      const { fetcher, read } = setup();
      const run = vi.fn(async () => unauthorizedResponse);

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
      expect(run).toHaveBeenCalledTimes(2);
      expect(read).toHaveBeenCalledTimes(2);
    });

    it("更新後の取り直しが通信失敗(status 0)のとき、errorにする", async () => {
      // Given
      const { fetcher } = setup();
      const run = vi
        .fn()
        .mockResolvedValueOnce(unauthorizedResponse)
        .mockResolvedValueOnce({ data: null, error: null, status: 0 });

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
    });

    it("サインインの読み取りの待機中にofflineの知らせが来ると、解決を待たずofflineにする", async () => {
      // Given
      const { fetcher, network } = setup({
        readings: [() => new Promise<Reading>(() => {})],
      });
      const run = vi.fn(async () => okResponse);
      const pending = fetcher.fetchContent(run);

      // When
      network.goOffline();

      // Then
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
        message: FETCH_ERROR_MESSAGE,
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
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it.each([
      [
        "クエリがstatus 0を返す",
        async () => ({ data: null, error: null, status: 0 }),
      ],
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
        signIn: {
          read: async () => {
            network.state.offline = true;
            return unknown;
          },
        },
        connectivity: network.connectivity,
        clock: createManualClock(),
      });

      // When
      const result = await fetcher.fetchContent(async () => okResponse);

      // Then
      expect(result).toEqual({ status: "offline" });
    });

    it("切断でも、HTTP応答のあるエラーはerrorのままにする", async () => {
      // Given
      const { fetcher, network } = setup();
      const run = async () => {
        network.state.offline = true;
        return { data: null, error: { message: "boom" }, status: 500 };
      };

      // When
      const result = await fetcher.fetchContent(run);

      // Then
      expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
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

    it("完了後に、offlineの購読を解除する", async () => {
      // Given
      const { fetcher, network } = setup();

      // When
      await fetcher.fetchContent(async () => okResponse);

      // Then
      expect(network.offlineListeners.size).toBe(0);
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
      expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
    });
  });

  describe("timeoutMsとonLateResult", () => {
    // 取得の終わる時刻を、手動の時計から決められるクエリで模す。
    function slowQuery(
      clock: ReturnType<typeof createManualClock>,
      delayMs: number,
    ) {
      return () =>
        new Promise<typeof okResponse>((resolve) => {
          clock.after(delayMs, () => resolve(okResponse));
        });
    }

    it("timeoutMsで時間切れになるとerrorを返す", async () => {
      // Given
      const { fetcher, clock } = setup();
      const pending = fetcher.fetchContent(slowQuery(clock, 5_000), {
        timeoutMs: FALLBACK_WAIT_MS,
      });

      // When
      await clock.advanceAsync(FALLBACK_WAIT_MS);

      // Then
      await expect(pending).resolves.toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it("取得中に切断になっていれば、時間切れはofflineを返す", async () => {
      // Given
      const { fetcher, clock, network } = setup();
      const pending = fetcher.fetchContent(slowQuery(clock, 5_000), {
        timeoutMs: FALLBACK_WAIT_MS,
      });
      network.state.offline = true;

      // When
      await clock.advanceAsync(FALLBACK_WAIT_MS);

      // Then
      await expect(pending).resolves.toEqual({ status: "offline" });
    });

    it("時間切れの後、取得の開始からFETCH_TIMEOUT_MS以内に終われば、onLateResultが結果で1回呼ばれる", async () => {
      // Given
      const { fetcher, clock } = setup();
      const onLateResult = vi.fn();
      const pending = fetcher.fetchContent(slowQuery(clock, 5_000), {
        timeoutMs: FALLBACK_WAIT_MS,
        onLateResult,
      });
      await clock.advanceAsync(FALLBACK_WAIT_MS);
      await pending;
      expect(onLateResult).not.toHaveBeenCalled();

      // When
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      expect(onLateResult).toHaveBeenCalledExactlyOnceWith({
        status: "ok",
        data: { id: "a" },
      });
      expect(clock.pendingCount()).toBe(0);
    });

    it("FETCH_TIMEOUT_MSを超えて終わった結果では、onLateResultを呼ばない", async () => {
      // Given
      const { fetcher, clock } = setup();
      const onLateResult = vi.fn();
      const pending = fetcher.fetchContent(
        slowQuery(clock, FETCH_TIMEOUT_MS + 1),
        { timeoutMs: FALLBACK_WAIT_MS, onLateResult },
      );

      // When
      await clock.advanceAsync(FETCH_TIMEOUT_MS + 2);
      await pending;

      // Then
      expect(onLateResult).not.toHaveBeenCalled();
      expect(clock.pendingCount()).toBe(0);
    });

    it("時間切れにならなかったときは、onLateResultを呼ばず、登録も残さない", async () => {
      // Given
      const { fetcher, clock } = setup();
      const onLateResult = vi.fn();

      // When
      const result = await fetcher.fetchContent(async () => okResponse, {
        timeoutMs: FALLBACK_WAIT_MS,
        onLateResult,
      });
      await clock.advanceAsync(FETCH_TIMEOUT_MS);

      // Then
      expect(result).toEqual({ status: "ok", data: { id: "a" } });
      expect(onLateResult).not.toHaveBeenCalled();
      expect(clock.pendingCount()).toBe(0);
    });

    it("上限がFETCH_TIMEOUT_MS以上のときは、時間切れの後の結果を待たない", async () => {
      // Given
      const { fetcher, clock } = setup();
      const onLateResult = vi.fn();
      const pending = fetcher.fetchContent(
        slowQuery(clock, FETCH_TIMEOUT_MS + 5),
        {
          onLateResult,
        },
      );

      // When
      await clock.advanceAsync(FETCH_TIMEOUT_MS + 10);
      await pending;

      // Then
      expect(onLateResult).not.toHaveBeenCalled();
    });
  });
});
