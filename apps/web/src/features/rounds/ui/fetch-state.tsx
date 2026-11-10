import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { FetchView } from "../domain/fetch-status";

// 取得中の表示。読み込み後の画面と形を揃えるため、画面ごとに渡す。
export function LoadingState({ loading }: { loading: ReactNode }) {
  const t = useTranslations("rounds");
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{t("fetchLoading")}</span>
      {loading}
    </div>
  );
}

export function NotFoundState() {
  const t = useTranslations("rounds");
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm">
      <p>{t("detailNotFound")}</p>
    </div>
  );
}

// okは画面ごとに描画するため受け取らない。
// loading以外は、親（flex列）の残りの領域の中心（縦横とも）に置く。
export function FetchState({
  view,
  onRetry,
  loading,
}: {
  view: Exclude<FetchView<unknown>, { status: "ok" }>;
  onRetry: () => void;
  loading: ReactNode;
}) {
  const t = useTranslations("rounds");
  switch (view.status) {
    case "loading":
      return <LoadingState loading={loading} />;
    case "not-found":
      return <NotFoundState />;
    case "offline":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm">
          <p>{t("fetchOffline")}</p>
          <Button variant="outline" onClick={onRetry}>
            {t("fetchRetry")}
          </Button>
        </div>
      );
    case "error":
      return (
        <div
          role="alert"
          className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm"
        >
          <p>{t(`fetchFailure.${view.reason}`)}</p>
          <Button variant="outline" onClick={onRetry}>
            {t("fetchRetry")}
          </Button>
        </div>
      );
  }
}
