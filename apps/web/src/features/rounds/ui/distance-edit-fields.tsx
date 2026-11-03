"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { DistanceConfig } from "../domain/distance-config";
import type { SyncOperation } from "../domain/sync-events";
import type { TargetFaceOption } from "../domain/target-face";
import { DistanceFields } from "./distance-fields";
import { useDistanceDraft } from "./use-distance-draft";

// distance-summary行のタップでポップアップ表示される、距離1件分の編集フォーム。
// 自身では開閉状態を持たず、ScorecardClient側の管理下でマウント/アンマウントされる
// （マウントのたびにdraftと起点が現在値から作られ、開いている間は`distance`の変化で書き換えない）。
export function DistanceEditFields({
  distance,
  hasShots,
  targetFaces,
  roundFormat,
  roundBowType,
  onSaved,
  onDeleted,
  onOpenChange,
  enqueue,
}: {
  distance: DistanceConfig;
  hasShots: boolean;
  targetFaces: TargetFaceOption[];
  roundFormat: string;
  roundBowType: string;
  onSaved: (updated: DistanceConfig) => void;
  onDeleted: () => void;
  onOpenChange: (open: boolean) => void;
  enqueue: (operation: SyncOperation) => void;
}) {
  const {
    draft,
    setDraft,
    fieldErrors,
    confirmOpen,
    setConfirmOpen,
    handleSave,
    handleDeleteClick,
    performDelete,
  } = useDistanceDraft({ distance, hasShots, onSaved, onDeleted, enqueue });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="flex flex-col gap-3">
          <DistanceFields
            distanceNumber={distance.distanceNumber}
            draft={draft}
            setDraft={setDraft}
            fieldErrors={fieldErrors}
            targetFaces={targetFaces}
            roundFormat={roundFormat}
            roundBowType={roundBowType}
            hasShots={hasShots}
          />

          <DistanceEditActions
            distanceNumber={distance.distanceNumber}
            onSave={handleSave}
            onDelete={handleDeleteClick}
          />
        </div>
      </DialogContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        description="この距離にはすでにスコアが記録されています。削除するとスコアも失われます。削除しますか？"
        onConfirm={performDelete}
        nested
      />
    </Dialog>
  );
}

function DistanceEditActions({
  distanceNumber,
  onSave,
  onDelete,
}: {
  distanceNumber: number;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <Button
        type="button"
        className="w-full"
        data-testid={`distance-config-save-${distanceNumber}`}
        onClick={onSave}
      >
        保存
      </Button>

      <div className="flex flex-col gap-3 border-t pt-3">
        <Button
          type="button"
          variant="destructive"
          className="w-full"
          data-testid={`distance-config-delete-${distanceNumber}`}
          onClick={onDelete}
        >
          距離を削除
        </Button>
      </div>
    </>
  );
}
