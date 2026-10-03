"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { FetchState } from "@/features/fetch-result/fetch-state";
import { useFetchResult } from "@/features/fetch-result/use-fetch-result";
import { createClient } from "@/lib/supabase/client";
import { loadRoundDetail } from "./load-round-detail";
import { RoundDetailFrame } from "./round-detail-frame";
import { parseRoundId } from "./round-detail-id";
import { ScorecardClient } from "./scorecard-client";

// ScorecardClientの設定パネル（45px）、合計バー（46px、-mt-6で設定パネルと接する）、
// 距離の一覧（gap-6/gap-4）と同じ形にする。
function ScorecardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-[45px] animate-pulse rounded-t-xl bg-muted" />
      <div className="-mt-6 h-[46px] animate-pulse rounded-b-xl bg-muted" />
      <div className="flex flex-col gap-4">
        <div className="h-12 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}

const NOT_FOUND = { message: "ラウンドが見つかりません。" };

// pathnameは取得のkeyにだけ使い、初回描画は取得中の枠になる。
// SSRのHTMLと、Service Workerが別URLへ返す枠のHTMLが同一になり、水和が一致する。
export function RoundDetailClient() {
  const roundId = parseRoundId(usePathname());
  return <RoundDetailLoader key={roundId ?? "invalid"} roundId={roundId} />;
}

function RoundDetailLoader({ roundId }: { roundId: string | null }) {
  const router = useRouter();
  const { view, retry } = useFetchResult(
    () =>
      roundId
        ? loadRoundDetail(createClient(), roundId)
        : Promise.resolve({ status: "not-found" as const }),
    [roundId],
  );
  const leaveRound = view.status === "ok" && view.data.leaveRound;

  useEffect(() => {
    if (leaveRound) router.replace("/rounds");
  }, [leaveRound, router]);

  if (roundId && view.status === "ok") {
    const { roundConfig, distances, shots, targetFaces } = view.data;
    return (
      <ScorecardClient
        roundId={roundId}
        initialRoundConfig={roundConfig}
        distances={distances}
        initialShots={shots}
        targetFaces={targetFaces}
      />
    );
  }
  return (
    <RoundDetailFrame>
      <FetchState
        view={view.status === "ok" ? { status: "loading" } : view}
        onRetry={retry}
        notFound={NOT_FOUND}
        loading={<ScorecardSkeleton />}
      />
    </RoundDetailFrame>
  );
}
