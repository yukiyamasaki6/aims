import type { ReactNode } from "react";
import { BackLink } from "./back-link";
import { useRoundOrigin } from "./use-round-origin";

// ヘッダー行はScorecardClientと同じ位置・高さにし、取得中から表示への遷移でヘッダーを動かさない。
// data-hydratedは付けない。付けると、E2Eのwaitが取得の完了より先に解ける。
export function RoundDetailFrame({ children }: { children: ReactNode }) {
  const origin = useRoundOrigin();
  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-xl shrink-0">
          <div className="flex h-14 items-center bg-card px-8">
            <BackLink origin={origin} />
          </div>
        </div>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-8 pb-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
