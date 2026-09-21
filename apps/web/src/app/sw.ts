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
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// ページ・RSCなど認証状態に依存するレスポンスはキャッシュ対象にしない
// （#479のシェル・データ分離設計が入るまでは、ページ内容自体をキャッシュ
// すると、サインアウト後も前のユーザーのデータが残り続けたり、認証ガードの
// リダイレクトがキャッシュ済みレスポンスにより迂回されたりする）。
// ここでキャッシュするのはビルド成果物の不変な静的アセットのみで、それ以外
// の全リクエスト（ナビゲーションを含む）は常にネットワークへ通す。
const runtimeCaching: RuntimeCaching[] = [
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
  // 同一オリジンの残り（ページ・RSC・API等）はキャッシュ対象外として
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
  navigationPreload: true,
  runtimeCaching,
  // 完全にオフラインでナビゲーションが失敗した場合のみ、認証非依存の
  // 静的な/offlineページ（serwist.config.jsでプリキャッシュ済み）を返す。
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
