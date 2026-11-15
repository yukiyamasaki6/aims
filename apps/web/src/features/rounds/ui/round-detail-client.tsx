"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { roundIdOfPath } from "../domain/round-routes";
import { FetchState, LoadingState, NotFoundState } from "./fetch-state";
import { RoundDetailFrame } from "./round-detail-frame";
import { useRoundProcedures } from "./rounds-context";
import { ScorecardClient } from "./scorecard-client";
import { Skeleton } from "./skeleton";
import { useFetchResult } from "./use-fetch-result";
import { useRoundScreen } from "./use-round-screen";

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

// 取得中・見つからない・エラーの本文。スクロールの入れ物と、幅を絞った列。
function DetailScroll({ children }: { children: ReactNode }) {
  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col p-8">
        {children}
      </div>
    </main>
  );
}

// pathnameは取得のkeyにだけ使い、初回描画は取得中の枠になる。
// SSRのHTMLと、Service Workerが別URLへ返す枠のHTMLが同一になり、水和が一致する。
// IDごとに部品を作り直す。詳細から別の詳細へ移っても、Nextのルーターは同じ枠の部品を作り直さないため、前のIDの状態が残る。
export function RoundDetailClient() {
  const roundId = roundIdOfPath(usePathname());
  return roundId ? (
    <RoundDetailLoader key={roundId} roundId={roundId} />
  ) : (
    <InvalidRoundDetail />
  );
}

// IDが読めないパス(枠のプレースホルダー、UUIDでないID)。問い合わせず、初回描画は取得中の枠、その後は見つからない。
function InvalidRoundDetail() {
  const { whenOnline } = useRoundProcedures();
  const { view } = useFetchResult<never>(notFoundNow, whenOnline);
  return (
    <RoundDetailFrame>
      <DetailScroll>
        {view.status === "loading" ? (
          <LoadingState loading={<ScorecardSkeleton />} />
        ) : (
          <NotFoundState />
        )}
      </DetailScroll>
    </RoundDetailFrame>
  );
}

const notFoundNow = () => Promise.resolve({ status: "not-found" as const });

// 存在の判断・取得・再試行は窓口が持つ。ここは窓口の状態を描くだけ。
function RoundDetailLoader({ roundId }: { roundId: string }) {
  const { view, retry, append } = useRoundScreen(roundId);
  if (view.status === "ok") {
    return (
      <ScorecardClient roundId={roundId} screen={view.data} append={append} />
    );
  }
  return (
    <RoundDetailFrame>
      <DetailScroll>
        <FetchState
          view={view}
          onRetry={retry}
          loading={<ScorecardSkeleton />}
        />
      </DetailScroll>
    </RoundDetailFrame>
  );
}
