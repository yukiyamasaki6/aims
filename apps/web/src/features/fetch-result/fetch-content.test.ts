import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_REQUIRED_MESSAGE } from "@/features/auth/errors";
import { fetchContent } from "./fetch-content";
import { FETCH_ERROR_MESSAGE } from "./fetch-result";

beforeEach(() => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
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

    it("クエリが通信失敗(status 0)を返すと、offlineにする", async () => {
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
      expect(result).toEqual({ status: "offline" });
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

    it("getSessionがAuthRetryableFetchErrorのとき、クエリを実行せずofflineにする", async () => {
      // Given
      const { client } = makeSupabase(async () => ({
        data: { session: null },
        error: { name: "AuthRetryableFetchError", message: "Failed to fetch" },
      }));
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetchContent(client, run);

      // Then
      expect(result).toEqual({ status: "offline" });
      expect(run).not.toHaveBeenCalled();
    });

    it("getSessionが例外を投げると、offlineにする", async () => {
      // Given
      const { client } = makeSupabase(async () => {
        throw new Error("boom");
      });
      const run = vi.fn(async () => okResponse);

      // When
      const result = await fetchContent(client, run);

      // Then
      expect(result).toEqual({ status: "offline" });
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
