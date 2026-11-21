"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { BlockingConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePageRestore } from "@/hooks/use-page-restore";
import {
  initialLinkGoogleFlow,
  type LinkGoogleFlow,
  linkGoogleReducer,
} from "../domain/link-google-flow";
import { useLinkGoogle } from "./link-google-context";
import { useAuthTexts } from "./use-auth-texts";
import { useScreenView } from "./use-screen-view";

// 設定の「Google認証」の行の値と操作(Googleのメールアドレス、「追加」「削除」、削除の確認、知らせ)。行の名は設定の機能が持つ。
// onBusyChange: 処理中かを設定パネルへ知らせる(処理中は閉じる・分類・戻るを受け付けない)。
// マウント時に、預かった戻りの処理か、オンラインのときの読み直しを行う。
export function LinkGoogleRow({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
}) {
  const linkGoogle = useLinkGoogle();
  const { state, view } = useScreenView(
    linkGoogleReducer,
    initialLinkGoogleFlow(linkGoogle.stored()),
  );
  const t = useTranslations("auth");
  const busy = state.pending !== null;
  const google = state.account?.google ?? null;
  const { dispatch } = view;
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  // 行を開いたとき1回だけ、戻りの処理か読み直しを行う。
  // biome-ignore lint/correctness/useExhaustiveDependencies: マウント時に1回だけ呼ぶ(預かった戻りは取り出して消す)。
  useEffect(() => {
    void linkGoogle.resume(view);
  }, []);
  usePageRestore(() => dispatch({ type: "restored" }));
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-h-11 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">
          {state.account === null
            ? t("linkGoogleLoading")
            : (google?.email ?? "")}
        </span>
        {state.account !== null && (
          <BusyButton
            type="button"
            variant="ghost"
            size="sm"
            busy={state.pending === "adding"}
            onClick={
              google === null
                ? () => void linkGoogle.start(view)
                : () => dispatch({ type: "confirmRequested" })
            }
          >
            {google === null ? t("linkGoogleAdd") : t("linkGoogleRemove")}
          </BusyButton>
        )}
      </div>
      <RowMessage flow={state} />
      <BlockingConfirmDialog
        open={state.confirming}
        onOpenChange={(open) => {
          if (!open) dispatch({ type: "confirmCancelled" });
        }}
        description={t("linkGoogleConfirm")}
        confirmLabel={t("linkGoogleRemove")}
        onConfirm={() =>
          google && void linkGoogle.remove({ identityId: google.id }, view)
        }
        busy={state.pending === "removing"}
        error={null}
        nested
      />
    </div>
  );
}

// 操作の結果の知らせ(失敗の理由か、追加・削除の成功)。
function RowMessage({ flow }: { flow: LinkGoogleFlow }) {
  const t = useTranslations("auth");
  const texts = useAuthTexts();
  const message = flow.error
    ? texts.failure(flow.error)
    : flow.notice === "added"
      ? t("linkGoogleAdded")
      : flow.notice === "removed"
        ? t("linkGoogleRemoved")
        : null;
  if (!message) return null;
  return (
    <p
      className={
        flow.error
          ? "pb-2 text-destructive text-sm"
          : "pb-2 text-muted-foreground text-sm"
      }
    >
      {message}
    </p>
  );
}
