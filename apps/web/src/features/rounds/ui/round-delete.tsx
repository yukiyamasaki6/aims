import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { RoundListItem } from "../domain/round-list";
import { useRoundProcedures } from "./rounds-context";

// ホームと履歴が共有する、カードからのラウンド削除。
// removed: この画面で削除したラウンドのID。取得の状態が変わっても失わない。target: 確認中のラウンド。
export function useRoundDelete() {
  const { deletion } = useRoundProcedures();
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState<RoundListItem | null>(null);

  function confirmDelete(round: RoundListItem) {
    void deletion.deleteRound(round.id);
    setRemoved((prev) => new Set(prev).add(round.id));
  }

  return {
    removed,
    target,
    requestDelete: setTarget,
    cancel: () => setTarget(null),
    confirmDelete,
  };
}

export function RoundDeleteDialog({
  target,
  onCancel,
  onConfirm,
}: {
  target: RoundListItem | null;
  onCancel: () => void;
  onConfirm: (round: RoundListItem) => void;
}) {
  const t = useTranslations("rounds");
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={onCancel}
      description={
        target?.name
          ? t("roundDeleteConfirmNamed", { name: target.name })
          : t("roundDeleteConfirm")
      }
      onConfirm={() => target && onConfirm(target)}
    />
  );
}
