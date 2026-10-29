import {
  AuthApiError,
  AuthRetryableFetchError,
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import {
  FALLBACK_WAIT_MS,
  FETCH_TIMEOUT_MS,
  fetchContent,
  withinFetchTimeout,
} from "./fetch-content";
import { FETCH_ERROR_MESSAGE, type FetchResult } from "./fetch-result";

const AUTH_REQUIRED_MESSAGE = "サインインが必要です。";

beforeEach(() => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const session = { user: { id: "u1" }, refresh_token: "rt-1" };
const okResponse = { data: { id: "a" }, error: null, status: 200 };

const unauthorizedResponse = {
  data: null,
  error: { code: "PGRST301", message: "JWT expired" },
  status: 401,
};

function makeSupabase(
  getSession: () => Promise<unknown>,
  refreshSession: () => Promise<unknown> = async () => ({
    data: { session },
    error: null,
  }),
) {
  const getSessionMock = vi.fn(getSession);
  const refreshSessionMock = vi.fn(refreshSession);
  return {
    client: {
      auth: {
        getSession: getSessionMock,
        refreshSession: refreshSessionMock,
        signOut: async () => ({ error: null }),
      },
    } as unknown as SupabaseClient,
    getSession: getSessionMock,
    refreshSession: refreshSessionMock,
  };
}

function readerOf(client: SupabaseClient) {
  return createSupabaseAuth(() => client);
}

describe("fetchContent", () => {
  describe("正常系", () => {
    it("authenticatedのとき、確かめたセッションでクエリし、結果を判定して返す", async () => {
      // Given
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetchContent(readerOf(client), run);

      // Then
      expect(result).toEqual({ status: "ok", data: { id: "a" } });
      expect(run).toHaveBeenCalledExactlyOnceWith({ userId: "u1" });
    });

    it("クエリが認証の拒否で返ると、更新を強制して確かめ、新しいセッションで取り直した結果を返す", async () => {
      // Given
      const refreshed = { user: { id: "u1" }, refresh_token: "rt-2" };
      const { client, refreshSession } = makeSupabase(
        async () => ({ data: { session } }),
        async () => ({ data: { session: refreshed }, error: null }),
      );
      const run = vi
        .fn()
        .mockResolvedValueOnce(unauthorizedResponse)
        .mockResolvedValueOnce(okResponse);

      // When
      const result = await fetchContent(readerOf(client), run);

      // Then
      expect(result).toEqual({ status: "ok", data: { id: "a" } });
      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenLastCalledWith({ userId: "u1" });
    });

    it("nullIsNotFoundを判定へ渡す", async () => {
      // Given
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const run = async () => ({ data: null, error: null, status: 200 });

      // When
      const result = await fetchContent(readerOf(client), run, {
        nullIsNotFound: true,
      });

      // Then
      expect(result).toEqual({ status: "not-found" });
    });

    it("クエリが通信失敗(status 0)を返すと、原因を断定せずerrorにする", async () => {
      // Given
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const run = async () => ({
        data: null,
        error: { message: "TypeError: Failed to fetch" },
        status: 0,
      });

      // When
      const result = await fetchContent(readerOf(client), run);

      // Then
      expect(result).toEqual({
        status: "error",
        message: "読み込めませんでした。",
      });
    });

    it("ローカル識別の有無で結果が変わらない", async () => {
      // Given
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const run = async () => okResponse;
      const without = await fetchContent(readerOf(client), run);
      localStorage.setItem("aims-local-identity", JSON.stringify({ id: "u1" }));

      // When
      const withIdentity = await fetchContent(readerOf(client), run);

      // Then
      expect(withIdentity).toEqual(without);
    });

    it("同じ読み手で続けて取得すると、取得のたびにサインインしている利用者を読み直す", async () => {
      // Given
      let current: typeof session | null = {
        user: { id: "user-a" },
        refresh_token: "rt-a",
      };
      const { client } = makeSupabase(async () => ({
        data: { session: current },
      }));
      const reader = readerOf(client);
      const run = vi.fn(async () => okResponse);

      // When
      await fetchContent(reader, run);
      current = { user: { id: "user-b" }, refresh_token: "rt-b" };
      await fetchContent(reader, run);

      // Then
      expect(run).toHaveBeenNthCalledWith(1, { userId: "user-a" });
      expect(run).toHaveBeenNthCalledWith(2, { userId: "user-b" });
    });
  });

  describe("異常系", () => {
    it("オフラインのとき、getSessionもクエリも呼ばずofflineにする", async () => {
      // Given
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const { client, getSession } = makeSupabase(async () => ({
        data: { session },
      }));
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetchContent(readerOf(client), run);

      // Then
      expect(result).toEqual({ status: "offline" });
      expect(getSession).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    });

    it("オンラインでunauthenticatedのとき、クエリを実行せずサインインが必要なerrorにする", async () => {
      // Given
      const { client } = makeSupabase(async () => ({
        data: { session: null },
        error: null,
      }));
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetchContent(readerOf(client), run);

      // Then
      expect(result).toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
      expect(run).not.toHaveBeenCalled();
    });

    it("同じ読み手で続けて取得し、2回目に未認証になると、2回目はクエリを実行せずサインインが必要なerrorにする", async () => {
      // Given
      let current: typeof session | null = session;
      const { client } = makeSupabase(async () => ({
        data: { session: current },
        error: null,
      }));
      const reader = readerOf(client);
      const run = vi.fn(async () => okResponse);

      // When
      const first = await fetchContent(reader, run);
      current = null;
      const second = await fetchContent(reader, run);

      // Then
      expect(first).toEqual({ status: "ok", data: { id: "a" } });
      expect(second).toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("getSessionがAuthRetryableFetchErrorのとき、クエリを実行せずerrorにする", async () => {
      // Given
      const { client } = makeSupabase(async () => ({
        data: { session: null },
        error: new AuthRetryableFetchError("Failed to fetch", 0),
      }));
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetchContent(readerOf(client), run);

      // Then
      expect(result).toEqual({
        status: "error",
        message: "読み込めませんでした。",
      });
      expect(run).not.toHaveBeenCalled();
    });

    it("クエリが認証の拒否で返り、更新が拒否されると、サインインが必要なerrorにする", async () => {
      // Given
      const { client } = makeSupabase(
        async () => ({ data: { session } }),
        async () => ({
          data: { session: null },
          error: new AuthApiError("revoked", 400, "refresh_token_not_found"),
        }),
      );
      const run = vi.fn(async () => unauthorizedResponse);

      // When
      const result = await fetchContent(readerOf(client), run);

      // Then
      expect(result).toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("クエリが認証の拒否で返り、更新の通信が失敗すると、errorにする", async () => {
      // Given
      const { client } = makeSupabase(
        async () => ({ data: { session } }),
        async () => ({
          data: { session: null },
          error: new AuthRetryableFetchError("Failed to fetch", 0),
        }),
      );
      const run = vi.fn(async () => unauthorizedResponse);

      // When
      const result = await fetchContent(readerOf(client), run);

      // Then
      expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("更新で確かめた後の取り直しも認証の拒否で返ると、サインインを求めずerrorにする", async () => {
      // Given
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const run = vi.fn(async () => unauthorizedResponse);

      // When
      const result = await fetchContent(readerOf(client), run);

      // Then
      expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
      expect(run).toHaveBeenCalledTimes(2);
    });

    it("getSessionが例外を投げると、errorにする", async () => {
      // Given
      const { client } = makeSupabase(async () => {
        throw new Error("boom");
      });
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetchContent(readerOf(client), run);

      // Then
      expect(result).toEqual({
        status: "error",
        message: "読み込めませんでした。",
      });
      expect(run).not.toHaveBeenCalled();
    });

    it("getSessionの待機中にofflineイベントが起きると、解決を待たずofflineにする", async () => {
      // Given
      const { client } = makeSupabase(() => new Promise(() => {}));
      const run = vi.fn(async () => okResponse);
      const pending = fetchContent(readerOf(client), run);

      // When
      window.dispatchEvent(new Event("offline"));

      // Then
      await expect(pending).resolves.toEqual({ status: "offline" });
      expect(run).not.toHaveBeenCalled();
    });

    it("getSessionが時間内に終わらないと（onLineがtrueのまま通信できない場合）、errorにする", async () => {
      // Given
      vi.useFakeTimers();
      const { client } = makeSupabase(() => new Promise(() => {}));
      const run = vi.fn(async () => okResponse);
      const pending = fetchContent(readerOf(client), run);

      // When
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);

      // Then
      await expect(pending).resolves.toEqual({
        status: "error",
        message: "読み込めませんでした。",
      });
      expect(run).not.toHaveBeenCalled();
    });

    it("クエリが時間内に終わらないときも、errorにする", async () => {
      // Given
      vi.useFakeTimers();
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const pending = fetchContent(
        readerOf(client),
        () => new Promise<typeof okResponse>(() => {}),
      );

      // When
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);

      // Then
      await expect(pending).resolves.toEqual({
        status: "error",
        message: "読み込めませんでした。",
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
      "取得中に回線が落ちてonLineがfalseになり、%sと、offlineにする",
      async (_name, query) => {
        // Given
        const { client } = makeSupabase(async () => ({ data: { session } }));
        const run = async () => {
          vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
          return query();
        };

        // When
        const result = await fetchContent(readerOf(client), run);

        // Then
        expect(result).toEqual({ status: "offline" });
      },
    );

    it("取得中に回線が落ちてonLineがfalseになり、クエリが時間内に終わらないと、offlineにする", async () => {
      // Given
      vi.useFakeTimers();
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const pending = fetchContent(readerOf(client), () => {
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
        return new Promise<typeof okResponse>(() => {});
      });

      // When
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);

      // Then
      await expect(pending).resolves.toEqual({ status: "offline" });
    });

    it("getSessionの失敗の時点でonLineがfalseなら、offlineにする", async () => {
      // Given
      const { client } = makeSupabase(async () => {
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
        throw new Error("boom");
      });

      // When
      const result = await fetchContent(
        readerOf(client),
        async () => okResponse,
      );

      // Then
      expect(result).toEqual({ status: "offline" });
    });

    it("onLineがfalseでも、HTTP応答のあるエラーはerrorのままにする", async () => {
      // Given
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const run = async () => {
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
        return { data: null, error: { message: "boom" }, status: 500 };
      };

      // When
      const result = await fetchContent(readerOf(client), run);

      // Then
      expect(result).toEqual({
        status: "error",
        message: "読み込めませんでした。",
      });
    });

    it("時間内に終われば、時間切れのタイマーを残さない", async () => {
      // Given
      vi.useFakeTimers();
      const { client } = makeSupabase(async () => ({ data: { session } }));

      // When
      const result = await fetchContent(
        readerOf(client),
        async () => okResponse,
      );

      // Then
      expect(result).toEqual({ status: "ok", data: { id: "a" } });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("完了後に、offlineイベントのリスナーを解除する", async () => {
      // Given
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const { client } = makeSupabase(async () => ({ data: { session } }));

      // When
      await fetchContent(readerOf(client), async () => okResponse);

      // Then
      expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));
    });

    it("クエリが例外を投げると、固定文のerrorにする", async () => {
      // Given
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const run = async () => {
        throw new Error("internal detail");
      };

      // When
      const result = await fetchContent(readerOf(client), run);

      // Then
      expect(result).toEqual({ status: "error", message: FETCH_ERROR_MESSAGE });
    });
  });

  describe("timeoutMsとonLateResult", () => {
    // 取得の終わる時刻を、テストから決められるクエリで模す。
    function slowQuery(delayMs: number) {
      return () =>
        new Promise<typeof okResponse>((resolve) => {
          setTimeout(() => resolve(okResponse), delayMs);
        });
    }

    it("timeoutMsで時間切れになるとerrorを返す", async () => {
      // Given
      vi.useFakeTimers();
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const pending = fetchContent(readerOf(client), slowQuery(5_000), {
        timeoutMs: FALLBACK_WAIT_MS,
      });

      // When
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);

      // Then
      await expect(pending).resolves.toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it("取得中にonLineがfalseになっていれば、時間切れはofflineを返す", async () => {
      // Given
      vi.useFakeTimers();
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const pending = fetchContent(readerOf(client), slowQuery(5_000), {
        timeoutMs: FALLBACK_WAIT_MS,
      });
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

      // When
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);

      // Then
      await expect(pending).resolves.toEqual({ status: "offline" });
    });

    it("時間切れの後、取得の開始からFETCH_TIMEOUT_MS以内に終われば、onLateResultが結果で1回呼ばれる", async () => {
      // Given
      vi.useFakeTimers();
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const onLateResult = vi.fn();
      const pending = fetchContent(readerOf(client), slowQuery(5_000), {
        timeoutMs: FALLBACK_WAIT_MS,
        onLateResult,
      });
      await vi.advanceTimersByTimeAsync(FALLBACK_WAIT_MS);
      await pending;
      expect(onLateResult).not.toHaveBeenCalled();

      // When
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);

      // Then
      expect(onLateResult).toHaveBeenCalledTimes(1);
      expect(onLateResult).toHaveBeenCalledWith({
        status: "ok",
        data: { id: "a" },
      });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("FETCH_TIMEOUT_MSを超えて終わった結果では、onLateResultを呼ばない", async () => {
      // Given
      vi.useFakeTimers();
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const onLateResult = vi.fn();
      const pending = fetchContent(
        readerOf(client),
        slowQuery(FETCH_TIMEOUT_MS + 1),
        {
          timeoutMs: FALLBACK_WAIT_MS,
          onLateResult,
        },
      );

      // When
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 2);
      await pending;

      // Then
      expect(onLateResult).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("時間切れにならなかったときは、onLateResultを呼ばず、タイマーも残さない", async () => {
      // Given
      vi.useFakeTimers();
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const onLateResult = vi.fn();

      // When
      const pending = fetchContent(readerOf(client), async () => okResponse, {
        timeoutMs: FALLBACK_WAIT_MS,
        onLateResult,
      });
      await vi.advanceTimersByTimeAsync(0);
      const result = await pending;
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);

      // Then
      expect(result).toEqual({ status: "ok", data: { id: "a" } });
      expect(onLateResult).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe(".retry(false)", () => {
    it("通信失敗で、再試行せず1回の呼び出しでstatus 0になる", async () => {
      // Given
      const fetchMock = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      const client = createClient("https://example.supabase.co", "anon-key", {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: fetchMock as unknown as typeof fetch },
      });

      // When
      const res = await client.from("rounds").select("*").retry(false);

      // Then
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(0);
    });
  });
});

describe("withinFetchTimeout", () => {
  const ok: FetchResult<string> = { status: "ok", data: "done" };

  // 終わるまでの時間をテストから決められる読み込みを模す。
  function loadingAfter(delayMs: number, result: FetchResult<string> = ok) {
    return new Promise<FetchResult<string>>((resolve) => {
      setTimeout(() => resolve(result), delayMs);
    });
  }

  describe("正常系", () => {
    it("上限の前に終われば、その結果をそのまま返し、タイマーを残さない", async () => {
      // Given
      vi.useFakeTimers();
      const pending = withinFetchTimeout(loadingAfter(100));

      // When
      await vi.advanceTimersByTimeAsync(100);
      const result = await pending;

      // Then
      expect(result).toEqual(ok);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("上限の前に終わった通信失敗などの結果も、そのまま返す", async () => {
      // Given
      vi.useFakeTimers();
      const notFound: FetchResult<string> = { status: "not-found" };
      const pending = withinFetchTimeout(loadingAfter(100, notFound));

      // When
      await vi.advanceTimersByTimeAsync(100);

      // Then
      await expect(pending).resolves.toEqual(notFound);
    });
  });

  describe("異常系", () => {
    it("終わらない読み込みは、FETCH_TIMEOUT_MS - 1では結果が出ず、FETCH_TIMEOUT_MSでerrorになる", async () => {
      // Given
      vi.useFakeTimers();
      const settled = vi.fn();
      withinFetchTimeout(new Promise<FetchResult<string>>(() => {})).then(
        settled,
      );

      // When
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - 1);
      const beforeLimit = settled.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1);

      // Then
      expect(beforeLimit).toBe(0);
      expect(settled).toHaveBeenCalledWith({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it("上限の時点でonLineがfalseなら、offlineを返す", async () => {
      // Given
      vi.useFakeTimers();
      const pending = withinFetchTimeout(
        new Promise<FetchResult<string>>(() => {}),
      );
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

      // When
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);

      // Then
      await expect(pending).resolves.toEqual({ status: "offline" });
    });

    it("上限の後に終わった結果は返さず、errorのままにする", async () => {
      // Given
      vi.useFakeTimers();
      const pending = withinFetchTimeout(
        loadingAfter(FETCH_TIMEOUT_MS + 1_000),
      );

      // When
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1_000);

      // Then
      await expect(pending).resolves.toEqual({
        status: "error",
        message: FETCH_ERROR_MESSAGE,
      });
    });

    it("読み込みが拒否されたら、そのまま拒否する", async () => {
      // Given
      vi.useFakeTimers();

      // When
      const failure = new Error("storage failed");
      const pending = withinFetchTimeout(Promise.reject(failure));

      // Then
      await expect(pending).rejects.toBe(failure);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
