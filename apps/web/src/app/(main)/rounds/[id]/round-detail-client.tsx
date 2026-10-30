"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { SessionReader } from "@/features/auth";
import type { LoadedRoundDetail } from "@/features/rounds/application/rounds-store";
import { FetchState } from "@/features/rounds/ui/fetch-state";
import { useRoundsStore } from "@/features/rounds/ui/rounds-context";
import { useFetchResult } from "@/features/rounds/ui/use-fetch-result";
import { RoundDetailFrame } from "./round-detail-frame";
import { parseRoundId } from "./round-detail-id";
import { ScorecardClient } from "./scorecard-client";
import { useCreationGone } from "./use-creation-gone";

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

const NOT_FOUND = { message: "ラウンドが見つかりません。" };

// pathnameは取得のkeyにだけ使い、初回描画は取得中の枠になる。
// SSRのHTMLと、Service Workerが別URLへ返す枠のHTMLが同一になり、水和が一致する。
export function RoundDetailClient({
  sessionReader,
}: {
  sessionReader: SessionReader;
}) {
  const roundId = parseRoundId(usePathname());
  return (
    <RoundDetailLoader
      key={roundId ?? "invalid"}
      roundId={roundId}
      sessionReader={sessionReader}
    />
  );
}

function RoundDetailLoader({
  roundId,
  sessionReader,
}: {
  roundId: string | null;
  sessionReader: SessionReader;
}) {
  const router = useRouter();
  const store = useRoundsStore();
  const { view, retry } = useFetchResult<LoadedRoundDetail>(
    () =>
      roundId
        ? store.load(roundId)
        : Promise.resolve({ status: "not-found" as const }),
    [roundId],
  );
  const deleted = view.status === "ok" && view.data.deleted;
  useCreationGone(roundId, retry);

  useEffect(() => {
    if (deleted) router.replace("/rounds");
  }, [deleted, router]);

  if (roundId && view.status === "ok" && !view.data.deleted) {
    return (
      <ScorecardClient
        sessionReader={sessionReader}
        roundId={roundId}
        loaded={view.data}
        onGone={() => router.replace("/rounds")}
        targetFaces={view.data.targetFaces}
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
