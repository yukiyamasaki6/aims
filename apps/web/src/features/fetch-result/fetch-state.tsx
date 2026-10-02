import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { FetchView } from "./fetch-result";

type NotFoundLink = { message: string; href: string; label: string };

// okは画面ごとに描画するため受け取らない。
export function FetchState({
  view,
  onRetry,
  notFound,
}: {
  view: Exclude<FetchView<unknown>, { status: "ok" }>;
  onRetry: () => void;
  notFound?: NotFoundLink;
}) {
  switch (view.status) {
    case "loading":
      return (
        <div role="status" aria-busy="true" className="space-y-3">
          <span className="sr-only">読み込み中</span>
          <div className="h-6 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
        </div>
      );
    case "not-found":
      return (
        <div className="space-y-3 text-sm">
          <p>{notFound?.message ?? "見つかりませんでした。"}</p>
          {notFound && (
            <Link href={notFound.href} className="text-primary underline">
              {notFound.label}
            </Link>
          )}
        </div>
      );
    case "offline":
      return (
        <div className="space-y-3 text-sm">
          <p className="font-medium">未接続</p>
          <p>通信できないため、内容を読み込めません。</p>
          <Button variant="outline" onClick={onRetry}>
            再試行
          </Button>
        </div>
      );
    case "error":
      return (
        <div role="alert" className="space-y-3 text-sm">
          <p>{view.message}</p>
          <Button variant="outline" onClick={onRetry}>
            再試行
          </Button>
        </div>
      );
  }
}
