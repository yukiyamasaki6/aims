"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import {
  TargetFaceInfo,
  type TargetFaceSpotLayout,
} from "@/components/target-face-icon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { deleteDistance, updateDistance } from "./actions";
import { BOW_TYPE_OPTIONS, FORMAT_OPTIONS, labelOf } from "./round-options";

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

// 距離1件分の情報表示（距離/Marked・的情報・エンド構成）。プリセット選択・
// ラウンド詳細の距離一覧で共通して使う。呼び出し側は
// `grid grid-cols-[auto_1fr_auto]`のコンテナ内に直接並べる想定
// （3つの要素がそれぞれ列になる）。
export function DistanceInfo({
  distance,
  isMarked,
  format,
  face,
  arrowsPerEnd,
  totalEnds,
  trailing,
}: {
  distance: number | null;
  isMarked: boolean;
  format: string;
  face: { size: number; target_face_spots: TargetFaceSpotLayout[] } | null;
  arrowsPerEnd: number;
  totalEnds: number;
  trailing?: ReactNode;
}) {
  return (
    <>
      <span>
        {[
          distance !== null ? `${distance}m` : null,
          format === "field" ? (isMarked ? "Marked" : "Unmarked") : null,
        ]
          .filter((part): part is string => part !== null)
          .join(" / ")}
      </span>
      <TargetFaceInfo face={face} />
      <span className="flex items-center justify-self-end gap-2 whitespace-nowrap">
        {arrowsPerEnd}本×{totalEnds}エンド
        {trailing}
      </span>
    </>
  );
}

export type DistanceInfoItem = {
  key: string | number;
  distance: number | null;
  isMarked: boolean;
  face: { size: number; target_face_spots: TargetFaceSpotLayout[] } | null;
  arrowsPerEnd: number;
  totalEnds: number;
  trailing?: ReactNode;
};

// 複数の距離情報を1つの共通グリッドとしてまとめて描画する。TargetFaceInfo
// 自体がサイズ表記を固定幅にして常に同じ幅になるため、DistanceInfoをそのまま
// 各行に並べるだけで、行をまたいで的情報の画像位置が揃う。
export function DistanceInfoList({
  items,
  format,
  className,
}: {
  items: DistanceInfoItem[];
  format: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr_auto] items-center gap-x-1 gap-y-2",
        className,
      )}
    >
      {items.map(({ key, ...item }) => (
        <DistanceInfo key={key} format={format} {...item} />
      ))}
    </div>
  );
}

// プリセット（またはラウンド構成全体）の内容表示（種別・弓種＋距離一覧）。
// プリセット選択画面の展開表示と、プリセット保存確認ダイアログの両方で
// 同じ見た目を共有するために使う。
export function PresetInfo({
  format,
  bowType,
  distances,
}: {
  format: string;
  bowType: string;
  distances: DistanceInfoItem[];
}) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <span data-testid="round-preset-format-bow-type">
        {labelOf(FORMAT_OPTIONS, format)} / {labelOf(BOW_TYPE_OPTIONS, bowType)}
      </span>
      <DistanceInfoList format={format} items={distances} />
    </div>
  );
}

// 的の選択UI。名称は一切表示せず、実際のリング配色・レイアウト（3つ目の
// トライアングル/バーティカル等）とサイズの数字だけで見分けられるようにする。
// 通常は選択中の1枚だけを的情報（TargetFaceInfo）として表示し、タップすると
// ポップアップで一覧（同じく的情報のリスト）から選び直せる。
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
        className="w-full disabled:cursor-not-allowed disabled:opacity-50"
      >
        <TargetFaceInfo face={selectedFace ?? null} />
      </DialogTrigger>
      <DialogContent nested>
        <div className="flex flex-col gap-2">
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
                "flex items-center rounded-md p-2 transition-colors hover:bg-muted",
                f.id === selectedId && "bg-muted ring-1 ring-primary",
              )}
            >
              <TargetFaceInfo face={f} />
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

// distance-summary行のタップでポップアップ表示される、距離1件分の編集フォーム。
// 自身では開閉状態を持たず、ScorecardClient側の管理下でマウント/アンマウントされる
// （マウントのたびにdraftが現在値へリセットされる）。
export function DistanceEditFields({
  distance,
  hasShots,
  targetFaces,
  roundFormat,
  onSaved,
  onDeleted,
  onOpenChange,
}: {
  distance: DistanceConfig;
  hasShots: boolean;
  targetFaces: TargetFaceOption[];
  roundFormat: string;
  onSaved: (updated: DistanceConfig) => void;
  onDeleted: () => void;
  onOpenChange: (open: boolean) => void;
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
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="flex flex-col gap-3">
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
                  distance:
                    e.target.value === "" ? null : Number(e.target.value),
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
                    onClick={() =>
                      setDraft((d) => ({ ...d, isMarked: o.value }))
                    }
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">的</span>
            <TargetFacePicker
              targetFaces={targetFaces}
              selectedId={draft.targetFaceId}
              onSelect={(id) => setDraft((d) => ({ ...d, targetFaceId: id }))}
              disabled={hasShots}
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

          {error && <p className="text-destructive text-sm">{error}</p>}

          <Button
            type="button"
            className="w-full"
            disabled={submitting}
            data-testid={`distance-config-save-${distance.distanceNumber}`}
            onClick={handleSave}
          >
            保存
          </Button>

          <div className="flex flex-col gap-3 border-t pt-3">
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              disabled={submitting}
              data-testid={`distance-config-delete-${distance.distanceNumber}`}
              onClick={handleDeleteClick}
            >
              距離を削除
            </Button>
          </div>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        description="この距離にはすでにスコアが記録されています。削除するとスコアも失われます。削除しますか？"
        onConfirm={performDelete}
      />
    </Dialog>
  );
}
