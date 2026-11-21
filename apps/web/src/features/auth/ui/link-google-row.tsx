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

// 設定の「Google認証」の行の値と操作(Googleのメールアドレス、「追加」「解除」、解除の確認、失敗の理由)。行の名は設定の機能が持つ。
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
  // 行の枠(設定の機能)が`flex-wrap`で、値と操作の横に並べ、失敗の段落を行全体の幅で下に折り返す。
  return (
    <>
      <div className="flex h-11 min-w-0 flex-1 items-center gap-2">
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
    </>
  );
}

// 失敗の理由。行の中身の下に、行全体の幅で足す(幅は行の枠が折り返しで与える)。知らせ(成功、取り消し)は出さない。
function RowMessage({ flow }: { flow: LinkGoogleFlow }) {
  const texts = useAuthTexts();
  const message = texts.failure(flow.error);
  if (!message) return null;
  return <p className="w-full pb-2 text-destructive text-sm">{message}</p>;
}
