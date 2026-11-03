import {
  CacheFirst,
  NetworkOnly,
  type RuntimeCaching,
  StaleWhileRevalidate,
} from "serwist";
import { PrecachedFrame, type PrecachedFrameDeps } from "./precached-frame";

// ページ内容・RSCなど認証状態に依存するレスポンスはキャッシュ対象にしない
// (サインアウト後も前のユーザーのデータが残り続けたり、認証ガードの
// リダイレクトがキャッシュ済みレスポンスにより迂回されたりする)。
// キャッシュするのはビルド成果物の不変な静的アセットと、データを含まない
// 画面の枠(プリキャッシュ)のみで、それ以外の全リクエストはネットワークへ通す。
export function createRuntimeCaching(
  frames: PrecachedFrameDeps,
): RuntimeCaching[] {
  return [
    {
      matcher: ({ request, url, sameOrigin }) =>
        sameOrigin &&
        request.mode === "navigate" &&
        frames.frameUrlOf(url.pathname) !== null,
      handler: new PrecachedFrame(frames),
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
    // 同一オリジンの残り(枠以外のページ・RSC・API等)はキャッシュ対象外として
    // ネットワークへ通す。クロスオリジンのリクエスト(Turnstile等)は
    // どのmatcherにもマッチさせず、SWのfetchハンドラを経由させない
    // (経由させるとTurnstileの検証が完了しなくなる不具合を確認したため)。
    {
      matcher: ({ sameOrigin }) => sameOrigin,
      handler: new NetworkOnly(),
    },
  ];
}
