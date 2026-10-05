"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { FetchResult } from "@/features/fetch-result/fetch-result";
import { FetchState } from "@/features/fetch-result/fetch-state";
import { useFetchResult } from "@/features/fetch-result/use-fetch-result";
import { createClient } from "@/lib/supabase/client";
import type { TargetFaceOption } from "./distance-config-row";
import { fetchTargetFaces } from "./fetch-round-detail";
import { loadRoundDetail } from "./load-round-detail";
import { RoundDetailFrame } from "./round-detail-frame";
import { parseRoundId } from "./round-detail-id";
import { ScorecardClient } from "./scorecard-client";
import { useCreationGone } from "./use-creation-gone";

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

const NO_TARGET_FACES: TargetFaceOption[] = [];
const NO_TARGET_FACES_RESULT: FetchResult<TargetFaceOption[]> = {
  status: "ok",
  data: NO_TARGET_FACES,
};

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
  const pending =
    view.status === "ok" ? view.data.pendingCreationEventId : null;
  // 作成が未確定のラウンドの的は、詳細を表示した後に背景で取得する。
  const { view: faces } = useFetchResult(
    () =>
      pending
        ? fetchTargetFaces(createClient())
        : Promise.resolve(NO_TARGET_FACES_RESULT),
    [pending],
  );
  useCreationGone(roundId, pending, retry);

  useEffect(() => {
    if (leaveRound) router.replace("/rounds");
  }, [leaveRound, router]);

  if (roundId && view.status === "ok") {
    return (
      <ScorecardClient
        roundId={roundId}
        loaded={view.data}
        targetFaces={
          pending
            ? faces.status === "ok"
              ? faces.data
              : NO_TARGET_FACES
            : view.data.targetFaces
        }
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
