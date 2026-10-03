import type { ReactNode } from "react";
import { BackToListLink } from "./back-to-list-link";

// ヘッダー行はScorecardClientと同じ位置・高さにし、取得中から表示への遷移でヘッダーを動かさない。
// data-hydratedは付けない。付けると、E2Eのwaitが取得の完了より先に解ける。
export function RoundDetailFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <main className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
          <div className="sticky top-0 z-30 flex h-14 items-center bg-card px-8">
            <BackToListLink />
          </div>
          <div className="px-8 py-4">{children}</div>
        </div>
      </main>
    </div>
  );
}
