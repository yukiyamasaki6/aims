"use client";

import { useState } from "react";
import {
  type TargetFaceSpotLayout,
  TargetFaceTile,
} from "@/components/target-face-icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { deleteDistance, updateDistance } from "./actions";

export type TargetFaceOption = {
  id: string;
  name: string;
  size: number;
  target_face_spots: TargetFaceSpotLayout[];
};

export type DistanceConfig = {
  id: string;
  distanceNumber: number;
  distance: number | null;
  totalEnds: number;
  arrowsPerEnd: number;
  targetFaceId: string;
  isMarked: boolean;
};

// 的の選択UI。名称は一切表示せず、実際のリング配色・レイアウト（3つ目の
// トライアングル/バーティカル等）とサイズの数字だけで見分けられるようにする。
// 通常は選択中の1枚だけを表示し、タップするとポップアップで一覧から選び直せる。
function TargetFacePicker({
  targetFaces,
  selectedId,
  onSelect,
  disabled,
}: {
  targetFaces: TargetFaceOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedFace = targetFaces.find((f) => f.id === selectedId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        data-testid="target-face-picker-trigger"
        disabled={disabled}
        aria-label={
          disabled
            ? `${selectedFace?.name ?? "的"}（スコア記録済みのため変更不可）`
            : selectedFace
              ? `${selectedFace.name}（タップで変更）`
              : "的を選択"
        }
        className="p-0 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {selectedFace ? (
          <TargetFaceTile
            spots={selectedFace.target_face_spots}
            sizeCm={selectedFace.size}
            pixelSize={80}
          />
        ) : (
          <span className="flex size-20 items-center justify-center rounded-lg border border-dashed text-muted-foreground text-xs">
            未選択
          </span>
        )}
      </DialogTrigger>
      <DialogContent>
        <div className="grid grid-cols-3 justify-items-center gap-2">
          {targetFaces.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-label={f.name}
              aria-pressed={f.id === selectedId}
              data-testid={`target-face-option-${f.id}`}
              onClick={() => {
                onSelect(f.id);
                setOpen(false);
              }}
              className={cn(
                "flex rounded-md p-0 transition-shadow hover:ring-2 hover:ring-muted-foreground/40 hover:ring-offset-2 hover:ring-offset-background",
                f.id === selectedId &&
                  "ring-2 ring-primary ring-offset-2 ring-offset-background hover:ring-primary",
              )}
            >
              <TargetFaceTile
                spots={f.target_face_spots}
                sizeCm={f.size}
                pixelSize={100}
              />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const MARKED_OPTIONS = [
  { value: true, label: "Marked" },
  { value: false, label: "Unmarked" },
];

// distance-summaryカードのヘッダーから展開される、距離1件分の編集フィールド。
// 自身では折りたたみ状態を持たず、開閉はScorecardClient側が管理する。
export function DistanceEditFields({
  distance,
  hasShots,
  targetFaces,
  roundFormat,
  onSaved,
  onDeleted,
}: {
  distance: DistanceConfig;
  hasShots: boolean;
  targetFaces: TargetFaceOption[];
  roundFormat: string;
  onSaved: (updated: DistanceConfig) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState(distance);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const result = await updateDistance({
      distanceId: distance.id,
      distance: draft.distance,
      totalEnds: draft.totalEnds,
      arrowsPerEnd: draft.arrowsPerEnd,
      targetFaceId: draft.targetFaceId,
      isMarked: draft.isMarked,
    });

    if (result?.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    onSaved(draft);
    setSubmitting(false);
  }

  async function performDelete() {
    setSubmitting(true);
    setError(null);

    const result = await deleteDistance({ distanceId: distance.id });
    if (result?.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    onDeleted();
  }

  function handleDeleteClick() {
    if (submitting) return;
    if (hasShots) {
      setConfirmOpen(true);
      return;
    }
    performDelete();
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`distance-config-distance-${distance.distanceNumber}`}
          className="text-muted-foreground text-xs"
        >
          距離（m）
        </label>
        <Input
          id={`distance-config-distance-${distance.distanceNumber}`}
          type="number"
          data-testid={`distance-config-distance-${distance.distanceNumber}`}
          value={draft.distance ?? ""}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              distance: e.target.value === "" ? null : Number(e.target.value),
            }))
          }
        />
      </div>

      {roundFormat === "field" && (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">
            Marked / Unmarked
          </span>
          <div className="grid grid-cols-2 gap-2">
            {MARKED_OPTIONS.map((o) => (
              <Button
                key={String(o.value)}
                type="button"
                variant={draft.isMarked === o.value ? "default" : "outline"}
                size="sm"
                data-testid={`distance-config-${o.label.toLowerCase()}-${distance.distanceNumber}`}
                onClick={() => setDraft((d) => ({ ...d, isMarked: o.value }))}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label
          htmlFor={`distance-config-total-ends-${distance.distanceNumber}`}
          className="text-muted-foreground text-xs"
        >
          総エンド数
        </label>
        <Input
          id={`distance-config-total-ends-${distance.distanceNumber}`}
          type="number"
          disabled={hasShots}
          data-testid={`distance-config-total-ends-${distance.distanceNumber}`}
          value={draft.totalEnds}
          onChange={(e) =>
            setDraft((d) => ({ ...d, totalEnds: Number(e.target.value) }))
          }
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor={`distance-config-arrows-${distance.distanceNumber}`}
          className="text-muted-foreground text-xs"
        >
          エンドあたりの本数
        </label>
        <Input
          id={`distance-config-arrows-${distance.distanceNumber}`}
          type="number"
          disabled={hasShots}
          data-testid={`distance-config-arrows-${distance.distanceNumber}`}
          value={draft.arrowsPerEnd}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              arrowsPerEnd: Number(e.target.value),
            }))
          }
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">的</span>
        <TargetFacePicker
          targetFaces={targetFaces}
          selectedId={draft.targetFaceId}
          onSelect={(id) => setDraft((d) => ({ ...d, targetFaceId: id }))}
          disabled={hasShots}
        />
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          data-testid={`distance-config-delete-${distance.distanceNumber}`}
          onClick={handleDeleteClick}
        >
          削除
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={submitting}
          data-testid={`distance-config-save-${distance.distanceNumber}`}
          onClick={handleSave}
        >
          保存
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        description="この距離にはすでにスコアが記録されています。削除するとスコアも失われます。削除しますか？"
        onConfirm={performDelete}
      />
    </div>
  );
}
