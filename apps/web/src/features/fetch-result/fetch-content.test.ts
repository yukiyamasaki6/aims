import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_REQUIRED_MESSAGE } from "@/features/auth/errors";
import {
  FALLBACK_WAIT_MS,
  FETCH_TIMEOUT_MS,
  fetchContent,
} from "./fetch-content";
import { FETCH_ERROR_MESSAGE } from "./fetch-result";

beforeEach(() => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const session = { user: { id: "u1" } };
const okResponse = { data: { id: "a" }, error: null, status: 200 };

function makeSupabase(getSession: () => Promise<unknown>) {
  const getSessionMock = vi.fn(getSession);
  return {
    client: {
      auth: { getSession: getSessionMock },
    } as unknown as SupabaseClient,
    getSession: getSessionMock,
  };
}

describe("fetchContent", () => {
  describe("正常系", () => {
    it("authenticatedのとき、クエリ結果を判定して返す", async () => {
      // Given
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetchContent(client, run);

      // Then
      expect(result).toEqual({ status: "ok", data: { id: "a" } });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("nullIsNotFoundを判定へ渡す", async () => {
      // Given
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const run = async () => ({ data: null, error: null, status: 200 });

      // When
      const result = await fetchContent(client, run, { nullIsNotFound: true });

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
      const result = await fetchContent(client, run);

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
      const without = await fetchContent(client, run);
      localStorage.setItem("aims-local-identity", JSON.stringify({ id: "u1" }));

      // When
      const withIdentity = await fetchContent(client, run);

      // Then
      expect(withIdentity).toEqual(without);
      localStorage.clear();
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
      const result = await fetchContent(client, run);

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
      const result = await fetchContent(client, run);

      // Then
      expect(result).toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
      expect(run).not.toHaveBeenCalled();
    });

    it("更新を拒否された(AuthApiError)ときも、unauthenticatedとして扱う", async () => {
      // Given
      const { client } = makeSupabase(async () => ({
        data: { session: null },
        error: { name: "AuthApiError", message: "refresh token not found" },
      }));
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetchContent(client, run);

      // Then
      expect(result).toEqual({
        status: "error",
        message: AUTH_REQUIRED_MESSAGE,
      });
      expect(run).not.toHaveBeenCalled();
    });

    it("getSessionがAuthRetryableFetchErrorのとき、クエリを実行せずerrorにする", async () => {
      // Given
      const { client } = makeSupabase(async () => ({
        data: { session: null },
        error: { name: "AuthRetryableFetchError", message: "Failed to fetch" },
      }));
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetchContent(client, run);

      // Then
      expect(result).toEqual({
        status: "error",
        message: "読み込めませんでした。",
      });
      expect(run).not.toHaveBeenCalled();
    });

    it("getSessionが例外を投げると、errorにする", async () => {
      // Given
      const { client } = makeSupabase(async () => {
        throw new Error("boom");
      });
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetchContent(client, run);

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
      const pending = fetchContent(client, run);

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
      const pending = fetchContent(client, run);

      // When
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);

      // Then
      await expect(pending).resolves.toEqual({
        status: "error",
        message: "読み込めませんでした。",
      });
      expect(run).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("クエリが時間内に終わらないときも、errorにする", async () => {
      // Given
      vi.useFakeTimers();
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const pending = fetchContent(
        client,
        () => new Promise<typeof okResponse>(() => {}),
      );

      // When
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);

      // Then
      await expect(pending).resolves.toEqual({
        status: "error",
        message: "読み込めませんでした。",
      });
      vi.useRealTimers();
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
        // Given: クエリの実行中にonLineがfalseになる
        const { client } = makeSupabase(async () => ({ data: { session } }));
        const run = async () => {
          vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
          return query();
        };

        // When
        const result = await fetchContent(client, run);

        // Then
        expect(result).toEqual({ status: "offline" });
      },
    );

    it("取得中に回線が落ちてonLineがfalseになり、クエリが時間内に終わらないと、offlineにする", async () => {
      // Given
      vi.useFakeTimers();
      const { client } = makeSupabase(async () => ({ data: { session } }));
      const pending = fetchContent(client, () => {
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
        return new Promise<typeof okResponse>(() => {});
      });

      // When
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);

      // Then
      await expect(pending).resolves.toEqual({ status: "offline" });
      vi.useRealTimers();
    });

    it("getSessionの失敗の時点でonLineがfalseなら、offlineにする", async () => {
      // Given
      const { client } = makeSupabase(async () => {
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
        throw new Error("boom");
      });

      // When
      const result = await fetchContent(client, async () => okResponse);

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
      const result = await fetchContent(client, run);

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
      const result = await fetchContent(client, async () => okResponse);

      // Then
      expect(result).toEqual({ status: "ok", data: { id: "a" } });
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    });

    it("完了後に、offlineイベントのリスナーを解除する", async () => {
      // Given
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const { client } = makeSupabase(async () => ({ data: { session } }));

      // When
      await fetchContent(client, async () => okResponse);

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
      const result = await fetchContent(client, run);

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
      const pending = fetchContent(client, slowQuery(5_000), {
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
      const pending = fetchContent(client, slowQuery(5_000), {
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
      const pending = fetchContent(client, slowQuery(5_000), {
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
      const pending = fetchContent(client, slowQuery(FETCH_TIMEOUT_MS + 1), {
        timeoutMs: FALLBACK_WAIT_MS,
        onLateResult,
      });

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
      const pending = fetchContent(client, async () => okResponse, {
        timeoutMs: FALLBACK_WAIT_MS,
        onLateResult,
      });
      await vi.advanceTimersByTimeAsync(0);

      // Then
      await expect(pending).resolves.toEqual({
        status: "ok",
        data: { id: "a" },
      });
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
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
