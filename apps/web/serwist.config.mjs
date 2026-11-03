import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { serwist } from "@serwist/next/config";
import {
  frameHtmlOf,
  OFFLINE_PATH,
  shellUrlOf,
} from "./src/features/offline-pwa/domain/offline-routes.ts";
import { ROUND_FRAME_PATHS } from "./src/features/rounds/domain/round-routes.ts";

// /offlineだけは認証に依存しない完全に静的なページなので、他の
// プリレンダーページとは別枠で個別にプリキャッシュする（sw.tsから
// ナビゲーション失敗時のフォールバックとして参照する）。ビルドごとの
// リビジョンは内容のハッシュから自動算出し、手動更新が要らないようにする。
const offlineHtml = readFileSync(".next/server/app/offline.html");
const offlineRevision = createHash("md5").update(offlineHtml).digest("hex");

// 画面の枠（/__shell/*。proxy.tsの対象外でnext.config.tsが実ルートへrewriteする）も、同じくHTMLの内容ハッシュをリビジョンにして、資産と同じプリキャッシュに入れる。HTMLが無ければreadFileSyncが失敗し、ビルドも失敗する。
const frameEntries = ROUND_FRAME_PATHS.map((framePath) => ({
  url: shellUrlOf(framePath),
  revision: createHash("md5")
    .update(readFileSync(`.next/server/app/${frameHtmlOf(framePath)}`))
    .digest("hex"),
}));

export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // プリレンダーされたページ（/, /signin, /rounds等)は認証状態によって
  // リダイレクト先が変わるため、自動ではプリキャッシュしない。枠は
  // /__shell/*で明示的に入れる。詳細はsw.tsのコメント参照。
  precachePrerendered: false,
  additionalPrecacheEntries: [
    { url: OFFLINE_PATH, revision: offlineRevision },
    ...frameEntries,
  ],
});
