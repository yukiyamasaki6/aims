/// <reference lib="webworker" />
import type {
  PrecacheEntry,
  RuntimeCaching,
  SerwistGlobalConfig,
} from "serwist";
import {
  CacheFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
  Strategy,
  type StrategyHandler,
} from "serwist";
import { frameUrlFor, SHELL_PREFIX } from "./sw-frames";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// 画面の枠（/rounds、/rounds/new、/rounds/<任意のID>）のナビゲーションは、
// ユーザーデータを含まない静的なHTMLなので、プリキャッシュから返す
// （キャッシュ優先）。枠が未格納ならネットワークへ落とし、通信にも失敗した
// ときはfallbacksが/offlineを返す。fallbacksのプラグインはStrategyの
// インスタンスのハンドラにしか付かないため、Strategyを継承する。
class PrecachedFrame extends Strategy {
  async _handle(request: Request, handler: StrategyHandler) {
    const frameUrl = frameUrlFor(new URL(request.url).pathname);
    const frame = frameUrl ? await serwist.matchPrecache(frameUrl) : undefined;
    return frame ?? handler.fetch(request);
  }
}

// ページ内容・RSCなど認証状態に依存するレスポンスはキャッシュ対象にしない
// （サインアウト後も前のユーザーのデータが残り続けたり、認証ガードの
// リダイレクトがキャッシュ済みレスポンスにより迂回されたりする）。
// キャッシュするのはビルド成果物の不変な静的アセットと、データを含まない
// 画面の枠（プリキャッシュ）のみで、それ以外の全リクエストはネットワークへ通す。
const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ request, url, sameOrigin }) =>
      sameOrigin &&
      request.mode === "navigate" &&
      frameUrlFor(url.pathname) !== null,
    handler: new PrecachedFrame(),
  },
  {
    matcher: /\.(?:eot|otf|ttc|ttf|woff|woff2)$/i,
    handler: new StaleWhileRevalidate({ cacheName: "static-font-assets" }),
  },
  {
    matcher: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
    handler: new StaleWhileRevalidate({ cacheName: "static-image-assets" }),
  },
  {
    matcher: /\/_next\/static\/.+\.js$/i,
    handler: new CacheFirst({ cacheName: "next-static-js-assets" }),
  },
  {
    matcher: /\.css$/i,
    handler: new StaleWhileRevalidate({ cacheName: "static-style-assets" }),
  },
  // 同一オリジンの残り（枠以外のページ・RSC・API等）はキャッシュ対象外として
  // ネットワークへ通す。クロスオリジンのリクエスト（Turnstile等）は
  // どのmatcherにもマッチさせず、SWのfetchハンドラを経由させない
  // （経由させるとTurnstileの検証が完了しなくなる不具合を確認したため）。
  {
    matcher: ({ sameOrigin }) => sameOrigin,
    handler: new NetworkOnly(),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  // 枠はキャッシュ優先で返すため、プリロードの取得は捨てられ無駄になる。
  navigationPreload: false,
  precacheOptions: {
    plugins: [
      {
        // /__shell/*がリダイレクトされた応答（未認証の/signinなど）を枠として
        // 保存しない。インストールを失敗させ、壊れた枠が配られるのを防ぐ。
        cacheWillUpdate: async ({ request, response }) => {
          if (
            response.redirected &&
            new URL(request.url).pathname.startsWith(`${SHELL_PREFIX}/`)
          ) {
            throw new Error(`${request.url}がリダイレクトされました。`);
          }
          return response;
        },
      },
    ],
  },
  runtimeCaching,
  // 枠のないパスのナビゲーション、または枠が未格納のナビゲーションが完全に
  // オフラインで失敗した場合のみ、認証非依存の静的な/offlineページ
  // （serwist.config.mjsでプリキャッシュ済み）を返す。
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.mode === "navigate",
      },
    ],
  },
});

serwist.addEventListeners();

// skipWaiting: trueのSerwistはSKIP_WAITINGメッセージを待ち受けないため、ここで
// 受ける。更新時に旧SWの停止と制御下のページのfetchが重なると、旧SWが再起動して
// 新SWがwaitingのまま残る（旧SWのアイドル停止、最大約30秒まで）ことがあり、
// ページ側（SwUpdateActivator）が検知してこのメッセージで有効化を再要求する。
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});
