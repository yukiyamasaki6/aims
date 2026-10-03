import type {
  HandlerDidErrorCallbackParam,
  PrecacheEntry,
  RouteMatchCallbackOptions,
  SerwistOptions,
} from "serwist";
import {
  CacheFirst,
  NetworkOnly,
  RegExpRoute,
  StaleWhileRevalidate,
  Strategy,
} from "serwist";
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

// sw.tsが登録するmessageリスナーと、self.skipWaiting()の呼び出し。
const swScope = vi.hoisted(() => ({
  messageListeners: [] as Array<(event: { data: unknown }) => void>,
  skipWaiting: vi.fn(),
}));

beforeAll(async () => {
  vi.stubGlobal("__SW_MANIFEST", MANIFEST);
  vi.stubGlobal("skipWaiting", swScope.skipWaiting);
  const add = self.addEventListener.bind(self);
  vi.spyOn(self, "addEventListener").mockImplementation(
    (type: string, listener: unknown, options?: unknown) => {
      if (type === "message") {
        swScope.messageListeners.push(
          listener as (typeof swScope.messageListeners)[number],
        );
      }
      add(type, listener as EventListener, options as boolean);
    },
  );
  await import("./sw");
});

describe("sw", () => {
  describe("読み込み", () => {
    it("ビルド時に注入された一覧をプリキャッシュする", () => {
      // Given
      // When
      const { precacheEntries } = config();

      // Then
      expect(precacheEntries).toEqual(MANIFEST);
    });

    it("Service Workerのイベントリスナーを登録する", () => {
      // Given
      // When
      // Then
      expect(sw.addEventListeners).toHaveBeenCalledTimes(1);
    });
  });

  describe("有効化の再要求", () => {
    it("SKIP_WAITINGメッセージを受けたらskipWaitingを呼ぶ", () => {
      // Given
      swScope.skipWaiting.mockClear();

      // When
      for (const listener of swScope.messageListeners) {
        listener({ data: { type: "SKIP_WAITING" } });
      }

      // Then
      expect(swScope.skipWaiting).toHaveBeenCalledTimes(1);
    });

    it("他のメッセージではskipWaitingを呼ばない", () => {
      // Given
      swScope.skipWaiting.mockClear();

      // When
      for (const listener of swScope.messageListeners) {
        listener({ data: { type: "OTHER" } });
        listener({ data: undefined });
      }

      // Then
      expect(swScope.skipWaiting).not.toHaveBeenCalled();
    });
  });

  describe("ランタイムキャッシュ", () => {
    describe("同一オリジンの静的アセット", () => {
      it.each([
        ["/fonts/geist.woff2", "static-font-assets"],
        ["/fonts/geist.TTF", "static-font-assets"],
        ["/icon.svg", "static-image-assets"],
        ["/images/photo.JPEG", "static-image-assets"],
        ["/_next/static/css/app.css", "static-style-assets"],
      ])("%sはStaleWhileRevalidateで%sにキャッシュする", (url, cacheName) => {
        // Given
        // When
        const handler = findHandler(url);

        // Then
        expect(handler).toBeInstanceOf(StaleWhileRevalidate);
        expect(handler).toHaveProperty("cacheName", cacheName);
      });

      it("/_next/static配下のJavaScriptはCacheFirstでnext-static-js-assetsにキャッシュする", () => {
        // Given
        const url = "/_next/static/chunks/main.js";

        // When
        const handler = findHandler(url);

        // Then
        expect(handler).toBeInstanceOf(CacheFirst);
        expect(handler).toHaveProperty("cacheName", "next-static-js-assets");
      });
    });

    describe("画面の枠のナビゲーション", () => {
      it.each([
        ["/rounds", "/__shell/rounds"],
        ["/rounds?tab=1#top", "/__shell/rounds"],
        ["/rounds/new", "/__shell/rounds/new"],
        ["/rounds/6f1c2f3e-0000-4000-8000-000000000000", "/__shell/rounds/_"],
        ["/rounds/abc", "/__shell/rounds/_"],
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

      it.each(["/rounds/1?_rsc=abc", "/rounds/new?_rsc=abc", "/rounds"])(
        "ナビゲーション以外（cors）の%sは枠にせずネットワークへ通す",
        (url) => {
          // Given
          // When
          const handler = findHandler(url, "cors");

          // Then
          expect(handler).toBeInstanceOf(NetworkOnly);
        },
      );

      it("クロスオリジンのナビゲーションは枠にしない", () => {
        // Given
        // When
        const handler = findHandler("https://example.com/rounds", "navigate");

        // Then
        expect(handler).toBeUndefined();
      });

      it.each([
        "/",
        "/signin",
        "/offline",
        "/rounds/",
        "/rounds/1/edit",
        "/roundsx",
      ])("枠のない%sのナビゲーションはネットワークへ通す", (url) => {
        // Given
        // When
        const handler = findHandler(url, "navigate");

        // Then
        expect(handler).toBeInstanceOf(NetworkOnly);
      });
    });

    describe("同一オリジンのその他のリクエスト", () => {
      it.each(["/", "/rounds/1?_rsc=abc", "/api/rounds", "/sw.js"])(
        "%sはキャッシュせずネットワークへ通す",
        (url) => {
          // Given
          // When
          const handler = findHandler(url);

          // Then
          expect(handler).toBeInstanceOf(NetworkOnly);
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

    function updated(url: string, redirected: boolean) {
      const response = { redirected } as Response;
      return {
        request: new Request(new URL(url, location.origin)),
        response,
        event: {} as ExtendableEvent,
        state: undefined,
      };
    }

    it("枠がリダイレクトされた応答は保存せずエラーにする", async () => {
      // Given
      const params = updated("/__shell/rounds", true);

      // When
      const result = guard()(params);

      // Then
      await expect(result).rejects.toThrow();
    });

    it.each([
      ["/__shell/rounds", false],
      ["/_next/static/chunks/main.js", true],
      ["/offline", true],
    ])("%s（redirected: %s）は保存する", async (url, redirected) => {
      // Given
      const params = updated(url, redirected);

      // When
      const result = await guard()(params);

      // Then
      expect(result).toBe(params.response);
    });

    it("ナビゲーションのプリロードは使わない", () => {
      // Given
      // When
      // Then
      expect(config().navigationPreload).toBe(false);
    });
  });
});
