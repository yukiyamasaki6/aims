/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";
import { precacheGuard } from "@/features/offline-pwa/infrastructure/precache-guard";
import { createRuntimeCaching } from "@/features/offline-pwa/infrastructure/runtime-caching";
import { roundFramePathOf } from "@/features/rounds/domain/round-routes";
import {
  CHANGE_PASSWORD_PATH,
  OFFLINE_PATH,
  SETTINGS_PATH,
  shellUrlOf,
} from "@/routes";

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
  precacheOptions: {
    plugins: [precacheGuard],
  },
  runtimeCaching: createRuntimeCaching({
    frameUrlOf: (pathname) => {
      const framePath =
        roundFramePathOf(pathname) ??
        (pathname === SETTINGS_PATH || pathname === CHANGE_PASSWORD_PATH
          ? pathname
          : null);
      return framePath === null ? null : shellUrlOf(framePath);
    },
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
