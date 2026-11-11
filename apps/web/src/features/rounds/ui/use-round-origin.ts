"use client";

import { useSyncExternalStore } from "react";
import { type RoundOrigin, roundOriginOf } from "../domain/round-routes";

const subscribeNothing = () => () => {};

// 詳細の遷移元を、現在のURLの検索部から読む。
// 詳細の枠は静的に生成するため、サーバー描画と水和は空の検索部(ホーム)で描き、水和の後にブラウザのURLを読む。
export function useRoundOrigin(): RoundOrigin {
  const search = useSyncExternalStore(
    subscribeNothing,
    () => window.location.search,
    () => "",
  );
  return roundOriginOf(search);
}
