"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import type { LoadedRoundDetail } from "../application/round-detail-store";
import { roundIdOfPath } from "../domain/round-routes";
import { FetchState } from "./fetch-state";
import { RoundDetailFrame } from "./round-detail-frame";
import { useRoundDetailStore, useRoundProcedures } from "./rounds-context";
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

function RoundDetailLoader({ roundId }: { roundId: string | null }) {
  const store = useRoundDetailStore();
  const { leaving } = useRoundProcedures();
  const { view, retry } = useFetchResult<LoadedRoundDetail>(
    () =>
      roundId
        ? store.load(roundId)
        : Promise.resolve({ status: "not-found" as const }),
    store.whenOnline,
  );
  const deleted = view.status === "ok" && view.data.deleted;
  useCreationGone(roundId, retry);

  useEffect(() => {
    if (deleted) leaving.leaveRound();
  }, [deleted, leaving]);

  if (roundId && view.status === "ok" && !view.data.deleted) {
    return (
      <ScorecardClient
        roundId={roundId}
        loaded={view.data}
        onGone={() => leaving.leaveRound()}
        targetFaces={view.data.targetFaces}
      />
    );
  }
  return (
    <RoundDetailFrame>
      <FetchState
        view={view.status === "ok" ? { status: "loading" } : view}
        onRetry={retry}
        loading={<ScorecardSkeleton />}
      />
    </RoundDetailFrame>
  );
}
