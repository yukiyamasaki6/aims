import { NetworkOnly, type RuntimeCaching } from "serwist";
import { PrecachedFrame, type PrecachedFrameDeps } from "./precached-frame";

// ページ内容・RSCなど認証状態に依存するレスポンスはキャッシュ対象にしない
// (サインアウト後も前のユーザーのデータが残り続けたり、認証ガードの
// リダイレクトがキャッシュ済みレスポンスにより迂回されたりする)。
// キャッシュするのはビルド成果物の静的アセットとデータを含まない画面の枠で、
// どちらもプリキャッシュ(serwist.config.mjs)に入れる。実行時の規則は枠だけで、
// ナビゲーションの失敗はfallbacksが/offlineを返す。
// それ以外(ナビゲーション以外の同一オリジンのリクエスト、クロスオリジンのリクエスト)は
// どの規則にも当てず、Service Workerが応答せずブラウザが取得する。
export function createRuntimeCaching(
  frames: PrecachedFrameDeps,
): RuntimeCaching[] {
  return [
    {
      matcher: ({ request, url }) =>
        request.mode === "navigate" && frames.frameUrlOf(url.pathname) !== null,
      handler: new PrecachedFrame(frames),
    },
    // 枠のない・枠が未格納のナビゲーションは、ネットワークへ通す。失敗したときは
    // sw.tsのfallbacksが/offlineを返す。ナビゲーション以外の同一オリジンの
    // リクエストと、クロスオリジンのリクエスト(Turnstile等)はどのmatcherにも
    // マッチさせず、SWのfetchハンドラを経由させない
    // (経由させるとTurnstileの検証が完了しなくなる不具合を確認したため)。
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkOnly(),
    },
  ];
}
