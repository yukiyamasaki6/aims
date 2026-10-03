import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { FetchView } from "./fetch-result";

type NotFoundMessage = { message: string };

// okは画面ごとに描画するため受け取らない。
// loading以外は、親（flex列）の残りの領域の中心（縦横とも）に置く。
export function FetchState({
  view,
  onRetry,
  notFound,
  loading,
}: {
  view: Exclude<FetchView<unknown>, { status: "ok" }>;
  onRetry: () => void;
  notFound?: NotFoundMessage;
  // 取得中の表示。読み込み後の画面と形を揃えるため、画面ごとに渡す。
  loading?: ReactNode;
}) {
  switch (view.status) {
    case "loading":
      return (
        <div
          role="status"
          aria-busy="true"
          className={loading ? undefined : "space-y-3"}
        >
          <span className="sr-only">読み込み中</span>
          {loading ?? (
            <>
              <div className="h-6 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-24 animate-pulse rounded bg-muted" />
            </>
          )}
        </div>
      );
    case "not-found":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm">
          <p>{notFound?.message ?? "見つかりませんでした。"}</p>
        </div>
      );
    case "offline":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm">
          <p>ネットワークに接続されていません</p>
          <Button variant="outline" onClick={onRetry}>
            再試行
          </Button>
        </div>
      );
    case "error":
      return (
        <div
          role="alert"
          className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm"
        >
          <p>{view.message}</p>
          <Button variant="outline" onClick={onRetry}>
            再試行
          </Button>
        </div>
      );
  }
}
