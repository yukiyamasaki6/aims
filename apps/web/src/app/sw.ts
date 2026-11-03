/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";
import {
  frameUrlFor,
  OFFLINE_PATH,
} from "@/features/offline-pwa/domain/offline-routes";
import { createRuntimeCaching } from "@/features/offline-pwa/infrastructure/runtime-caching";
import { shellFrameGuard } from "@/features/offline-pwa/infrastructure/shell-guard";
import { roundFramePathOf } from "@/features/rounds/domain/round-routes";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // biome-ignore lint/style/useNamingConvention: Serwistがビルド時に埋め込む名前
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist: Serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // 新しいビルドは待機させ、ページ(SwUpdateActivator)のSKIP_WAITINGで有効にする
  // （Serwistが既定で待ち受ける）。clientsClaimは、初回の登録で最初の画面を
  // 制御するために残す。
  clientsClaim: true,
  // 枠はキャッシュ優先で返すため、プリロードの取得は捨てられ無駄になる。
  navigationPreload: false,
  precacheOptions: {
    plugins: [shellFrameGuard],
  },
  runtimeCaching: createRuntimeCaching({
    frameUrlOf: (pathname) => frameUrlFor(pathname, roundFramePathOf),
    // serwistは生成の後に参照する(ハンドラは生成の後にだけ呼ばれる)。
    matchPrecache: (url) => serwist.matchPrecache(url),
  }),
  // 枠のないパスのナビゲーション、または枠が未格納のナビゲーションが完全に
  // オフラインで失敗した場合のみ、認証非依存の静的な/offlineページ
  // （serwist.config.mjsでプリキャッシュ済み）を返す。
  fallbacks: {
    entries: [
      {
        url: OFFLINE_PATH,
        matcher: ({ request }) => request.mode === "navigate",
      },
    ],
  },
});

serwist.addEventListeners();
