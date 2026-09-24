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
} from "serwist";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Serwistはimport時にService Workerのイベントリスナー登録等の副作用を持つ外部パッケージのため、コンストラクタに渡された構成を捕捉するスタブに差し替える。キャッシュ戦略とルートの照合はserwistの実物を使う。
const sw = vi.hoisted(() => ({
  config: undefined as SerwistOptions | undefined,
  addEventListeners: vi.fn(),
}));
vi.mock("serwist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("serwist")>()),
  Serwist: class {
    constructor(config: SerwistOptions) {
      sw.config = config;
    }
    addEventListeners = sw.addEventListeners;
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

function matchOptions(url: string): RouteMatchCallbackOptions {
  const parsed = new URL(url, location.origin);
  return {
    url: parsed,
    request: { mode: "no-cors" } as Request,
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
function findHandler(url: string) {
  const options = matchOptions(url);
  return config().runtimeCaching?.find(({ matcher, handler }) =>
    matcher instanceof RegExp
      ? new RegExpRoute(matcher, handler).match(options)
      : typeof matcher === "function" && matcher(options),
  )?.handler;
}

beforeAll(async () => {
  vi.stubGlobal("__SW_MANIFEST", MANIFEST);
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

    describe("同一オリジンのその他のリクエスト", () => {
      it.each(["/", "/rounds", "/rounds/1?_rsc=abc", "/api/rounds", "/sw.js"])(
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
});
