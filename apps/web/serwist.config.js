import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { serwist } from "@serwist/next/config";

// /offlineだけは認証に依存しない完全に静的なページなので、他の
// プリレンダーページとは別枠で個別にプリキャッシュする（sw.tsから
// ナビゲーション失敗時のフォールバックとして参照する）。ビルドごとの
// リビジョンは内容のハッシュから自動算出し、手動更新が要らないようにする。
const offlineHtml = readFileSync(".next/server/app/offline.html");
const offlineRevision = createHash("md5").update(offlineHtml).digest("hex");

export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // プリレンダーされたページ（/, /signin等)は認証状態によってリダイレクト
  // 先が変わるため、プリキャッシュ対象から外す。詳細はsw.tsのコメント参照。
  precachePrerendered: false,
  additionalPrecacheEntries: [{ url: "/offline", revision: offlineRevision }],
});
