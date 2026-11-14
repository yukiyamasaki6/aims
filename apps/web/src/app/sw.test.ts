import type {
  HandlerDidErrorCallbackParam,
  PrecacheEntry,
  RouteMatchCallbackOptions,
  SerwistOptions,
} from "serwist";
import { NetworkOnly, RegExpRoute, Strategy } from "serwist";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Serwistはimport時にService Workerのイベントリスナー登録等の副作用を持つ外部パッケージのため、コンストラクタに渡された構成を捕捉するスタブに差し替える。キャッシュ戦略とルートの照合はserwistの実物を使う。
const sw = vi.hoisted(() => ({
  config: undefined as SerwistOptions | undefined,
  addEventListeners: vi.fn(),
  matchPrecache: vi.fn(),
}));
vi.mock("serwist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("serwist")>()),
  Serwist: class {
    constructor(config: SerwistOptions) {
      sw.config = config;
    }
    addEventListeners = sw.addEventListeners;
    matchPrecache = sw.matchPrecache;
  },
}));

// ビルド時にserwistが注入するプリキャッシュ対象の一覧。
const MANIFEST: PrecacheEntry[] = [
  { url: "/offline", revision: "abc123" },
  { url: "/_next/static/chunks/main.js", revision: null },
];

function config(): SerwistOptions {
  if (!sw.config) throw new Error("Serwistが構成されていません。");
  return sw.config;
}

function matchOptions(
  url: string,
  mode: RequestMode = "no-cors",
): RouteMatchCallbackOptions {
  const parsed = new URL(url, location.origin);
  return {
    url: parsed,
    request: { mode } as Request,
    sameOrigin: parsed.origin === location.origin,
    event: {} as ExtendableEvent,
  };
}

// ネットワークへの取得が失敗したリクエストとして、フォールバックの判定に渡す引数。
function failedFetch(mode: RequestMode): HandlerDidErrorCallbackParam {
  return {
    request: { mode } as Request,
    event: {} as ExtendableEvent,
    error: new TypeError("Failed to fetch"),
  };
}

// serwistと同じく、runtimeCachingを先頭から照合し最初にマッチしたハンドラを返す。
function findHandler(url: string, mode: RequestMode = "no-cors") {
  const options = matchOptions(url, mode);
  return config().runtimeCaching?.find(({ matcher, handler }) =>
    matcher instanceof RegExp
      ? new RegExpRoute(matcher, handler).match(options)
      : typeof matcher === "function" && matcher(options),
  )?.handler;
}

// 枠のハンドラ（PrecachedFrame）の取得処理を、ネットワーク取得をスタブにして直接呼ぶ。
async function handleFrame(url: string, fetchStub: () => Promise<Response>) {
  const handler = findHandler(url, "navigate") as unknown as {
    _handle(request: Request, handler: { fetch: unknown }): Promise<Response>;
  };
  return handler._handle(new Request(new URL(url, location.origin)), {
    fetch: fetchStub,
  });
}

beforeEach(() => {
  sw.matchPrecache.mockReset();
});

beforeAll(async () => {
  vi.stubGlobal("__SW_MANIFEST", MANIFEST);
  await import("./sw");
});

describe("sw", () => {
  describe("ランタイムキャッシュ", () => {
    describe("画面の枠のナビゲーション", () => {
      it.each([
        ["/rounds", "/__shell/rounds"],
        ["/rounds?tab=1#top", "/__shell/rounds"],
        ["/rounds/new", "/__shell/rounds/new"],
        ["/rounds/6f1c2f3e-0000-4000-8000-000000000000", "/__shell/rounds/_"],
        ["/rounds/abc", "/__shell/rounds/_"],
        ["/settings", "/__shell/settings"],
        ["/settings?tab=1#top", "/__shell/settings"],
        ["/settings/password", "/__shell/settings/password"],
        ["/settings/password?tab=1#top", "/__shell/settings/password"],
      ])("%sはプリキャッシュの%sを返す", async (url, frameUrl) => {
        // Given
        const frame = new Response("frame");
        sw.matchPrecache.mockResolvedValue(frame);
        const network = vi.fn();

        // When
        const handler = findHandler(url, "navigate");
        const response = await handleFrame(url, network);

        // Then
        expect(handler).toBeInstanceOf(Strategy);
        expect(response).toBe(frame);
        expect(sw.matchPrecache).toHaveBeenCalledWith(frameUrl);
        expect(network).not.toHaveBeenCalled();
      });

      it("枠が未格納ならネットワークから取得する", async () => {
        // Given
        sw.matchPrecache.mockResolvedValue(undefined);
        const fetched = new Response("network");

        // When
        const response = await handleFrame("/rounds", async () => fetched);

        // Then
        expect(response).toBe(fetched);
      });

      it("枠が未格納でネットワークも失敗したら、失敗を伝えてfallbacksに委ねる", async () => {
        // Given
        sw.matchPrecache.mockResolvedValue(undefined);

        // When
        const result = handleFrame("/rounds", async () => {
          throw new TypeError("Failed to fetch");
        });

        // Then
        await expect(result).rejects.toThrow("Failed to fetch");
      });

      it.each([
        "/",
        "/signin",
        "/offline",
        "/rounds/",
        "/rounds/1/edit",
        "/roundsx",
        "/settings/x",
        "/settingsx",
        "/settings/",
      ])("枠のない%sのナビゲーションはネットワークへ通す", (url) => {
        // Given
        // When
        const handler = findHandler(url, "navigate");

        // Then
        expect(handler).toBeInstanceOf(NetworkOnly);
      });
    });

    describe("同一オリジンのその他のリクエスト", () => {
      it.each(["/rounds/1?_rsc=abc", "/api/rounds", "/sw.js"])(
        "%sはどのルートにもマッチさせない",
        (url) => {
          // Given
          // When
          const handler = findHandler(url);

          // Then
          expect(handler).toBeUndefined();
        },
      );
    });

    describe("クロスオリジンのリクエスト", () => {
      it.each([
        "https://challenges.cloudflare.com/turnstile/v0/api.js",
        "https://fonts.example.com/geist.woff2",
        "https://example.supabase.co/auth/v1/user",
      ])("%sはどのルートにもマッチさせない", (url) => {
        // Given
        // When
        const handler = findHandler(url);

        // Then
        expect(handler).toBeUndefined();
      });
    });
  });

  describe("オフライン時のフォールバック", () => {
    it("ナビゲーションのリクエストには/offlineを返す", () => {
      // Given
      const [entry] = config().fallbacks?.entries ?? [];

      // When
      const matched = entry.matcher(failedFetch("navigate"));

      // Then
      expect(entry.url).toBe("/offline");
      expect(matched).toBe(true);
    });

    it.each<RequestMode>(["cors", "no-cors", "same-origin"])(
      "ナビゲーション以外（%s）のリクエストには返さない",
      (mode) => {
        // Given
        const [entry] = config().fallbacks?.entries ?? [];

        // When
        const matched = entry.matcher(failedFetch(mode));

        // Then
        expect(matched).toBe(false);
      },
    );
  });

  describe("プリキャッシュ", () => {
    function guard() {
      const plugin = config().precacheOptions?.plugins?.[0];
      if (!plugin?.cacheWillUpdate) throw new Error("ガードがありません。");
      return plugin.cacheWillUpdate;
    }

    function updated(url: string, status = 200) {
      const response = {
        ok: status < 400,
        status,
      } as Response;
      return {
        request: new Request(new URL(url, location.origin)),
        response,
        event: {} as ExtendableEvent,
        state: undefined,
      };
    }

    it.each([404, 500])(
      "ステータス%sの応答は保存せずエラーにする",
      async (status) => {
        // Given
        // When
        const params = updated("/_next/static/chunks/main.js", status);
        const result = guard()(params);

        // Then
        await expect(result).rejects.toThrow();
      },
    );

    it.each([
      "/__shell/rounds",
      "/__shell/settings",
      "/__shell/settings/password",
      "/_next/static/chunks/main.js",
      "/offline",
    ])("%sは保存する", async (url) => {
      // Given
      // When
      const params = updated(url);
      const result = await guard()(params);

      // Then
      expect(result).toBe(params.response);
    });
  });
});
