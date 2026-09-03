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
  format: string;
  bow_type: string[];
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

// フィルタ（種別・弓種）は「すべて」も選択肢に含める。ラウンドの種別・弓種を
// 既定にはするが、絞り込みが自由度を奪って目的の的を選べなくなることが
// ないよう、常に全件へ戻れる逃げ道を残す。
const FILTER_ALL = "all";
const FORMAT_FILTER_OPTIONS = [
  { value: FILTER_ALL, label: "すべて" },
  ...FORMAT_OPTIONS,
];
const BOW_TYPE_FILTER_OPTIONS = [
  { value: FILTER_ALL, label: "すべて" },
  ...BOW_TYPE_OPTIONS,
];

// 的の選択UI。名称は一切表示せず、実際のリング配色・レイアウト（3つ目の
// トライアングル/バーティカル等）とサイズの数字だけで見分けられるようにする。
// 通常は選択中の1枚だけを的情報（TargetFaceInfo）として表示し、タップすると
// ポップアップで一覧（同じく的情報のリスト）から選び直せる。
function TargetFacePicker({
  targetFaces,
  selectedId,
  roundFormat,
  roundBowType,
  onSelect,
  disabled,
}: {
  targetFaces: TargetFaceOption[];
  selectedId: string;
  roundFormat: string;
  roundBowType: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // ラウンドの種別・弓種に対応するタブを既定にする。選び直した場合はダイアログを
  // 再度開いてもそのまま保持する（開くたびに毎回既定へ戻すと、直前に見ていた
  // タブを見失ってしまうため）。
  const [selectedFormat, setSelectedFormat] = useState(roundFormat);
  const [selectedBowType, setSelectedBowType] = useState(roundBowType);
  const selectedFace = targetFaces.find((f) => f.id === selectedId);
  const visibleFaces = targetFaces.filter(
    (f) =>
      (selectedFormat === FILTER_ALL || f.format === selectedFormat) &&
      (selectedBowType === FILTER_ALL || f.bow_type.includes(selectedBowType)),
  );

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
      {/* フィルタで絞り込んだ的の件数（3件〜19件）によってポップアップ自体の
          大きさが変わらないよう高さを固定し、フィルタ部分は常に見える位置に
          固定した上で、的の一覧部分だけをスクロールさせる。 */}
      <DialogContent
        nested
        className="flex h-[70vh] flex-col overflow-y-hidden"
      >
        <div className="flex h-full flex-col gap-3">
          <div className="grid grid-cols-4 gap-2">
            {FORMAT_FILTER_OPTIONS.map((o) => (
              <Button
                key={o.value}
                type="button"
                variant={selectedFormat === o.value ? "default" : "outline"}
                size="sm"
                data-testid={`target-face-format-tab-${o.value}`}
                onClick={() => setSelectedFormat(o.value)}
              >
                {o.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {BOW_TYPE_FILTER_OPTIONS.map((o) => (
              <Button
                key={o.value}
                type="button"
                variant={selectedBowType === o.value ? "default" : "outline"}
                size="sm"
                data-testid={`target-face-bow-type-tab-${o.value}`}
                onClick={() => setSelectedBowType(o.value)}
              >
                {o.label}
              </Button>
            ))}
          </div>
          {/* 選択中の項目に付くring（box-shadow）がコンテナの縁に接して
              overflowで見切れないよう、-mx-1で横幅（上のタブ行との揃え）を
              保ちつつ、内側に上下左右のpを取ってringの逃げ場を作る。 */}
          <div className="-mx-1 flex flex-1 flex-col gap-2 overflow-y-auto p-1">
            {visibleFaces.map((f) => (
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
                  "flex shrink-0 items-center rounded-md p-2 transition-colors hover:bg-muted",
                  f.id === selectedId && "bg-muted ring-1 ring-primary",
                )}
              >
                <TargetFaceInfo face={f} />
              </button>
            ))}
          </div>
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
  roundBowType,
  onSaved,
  onDeleted,
  onOpenChange,
}: {
  distance: DistanceConfig;
  hasShots: boolean;
  targetFaces: TargetFaceOption[];
  roundFormat: string;
  roundBowType: string;
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
              roundFormat={roundFormat}
              roundBowType={roundBowType}
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
