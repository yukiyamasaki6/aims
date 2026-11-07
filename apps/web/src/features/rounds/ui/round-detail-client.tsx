"use client";

import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import type { LoadedRound } from "../application/round-handle";
import type { FetchView } from "../domain/fetch-status";
import { roundIdOfPath } from "../domain/round-routes";
import { FetchState } from "./fetch-state";
import { RoundDetailFrame } from "./round-detail-frame";
import { useRoundDetailStore } from "./rounds-context";
import { ScorecardClient } from "./scorecard-client";
import { Skeleton } from "./skeleton";
import { useCreationGone } from "./use-creation-gone";
import { useFetchResult } from "./use-fetch-result";

// 設定カードと合計バー（45px+46px、-mt-6で接するため合わせて91px）を1枠で、
// 距離の一覧は標準の1距離（6本×6エンド）のカードの高さの1枠で写す。
// 区切り線や中の仕切りは写さない。
function ScorecardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-[91px] rounded-xl" />
      <Skeleton className="h-[351px] rounded-xl" />
    </div>
  );
}

// pathnameは取得のkeyにだけ使い、初回描画は取得中の枠になる。
// SSRのHTMLと、Service Workerが別URLへ返す枠のHTMLが同一になり、水和が一致する。
export function RoundDetailClient() {
  const roundId = roundIdOfPath(usePathname());
  return <RoundDetailLoader key={roundId ?? "invalid"} roundId={roundId} />;
}

// スコアカードを出さないときの枠の表示。読み込みが済んでいれば、無いと分かった(`gone`)ときは見つからない、それ以外は取得中。
function frameView(
  view: FetchView<LoadedRound>,
  gone: boolean,
): Exclude<FetchView<unknown>, { status: "ok" }> {
  if (view.status !== "ok") return view;
  return { status: gone ? "not-found" : "loading" };
}

function RoundDetailLoader({ roundId }: { roundId: string | null }) {
  const store = useRoundDetailStore();
  const { view, retry } = useFetchResult<LoadedRound>(
    () =>
      roundId
        ? store.load(roundId)
        : Promise.resolve({ status: "not-found" as const }),
    store.whenOnline,
  );
  // 開いている間に、ラウンドが無いと分かったか(他の端末で削除された、取り直したサーバーに無い)。部品の寿命まで戻さない。
  const [gone, setGone] = useState(false);
  const markGone = useCallback(() => setGone(true), []);
  useCreationGone(roundId, retry);

  if (roundId && view.status === "ok" && !gone) {
    return (
      <ScorecardClient
        roundId={roundId}
        loaded={view.data}
        onGone={markGone}
        targetFaces={view.data.targetFaces}
      />
    );
  }
  return (
    <RoundDetailFrame>
      <FetchState
        view={frameView(view, gone)}
        onRetry={retry}
        loading={<ScorecardSkeleton />}
      />
    </RoundDetailFrame>
  );
}
