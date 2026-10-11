"use client";

import { cn } from "@/lib/utils";
import { labelOf } from "./option-label";
import { BOW_TYPE_OPTIONS, FORMAT_OPTIONS } from "./round-constants";
import { TargetFaceInfo, type TargetFaceView } from "./target-face-icon";

// 距離1件分の情報表示（距離/Marked・的情報・エンド構成）。プリセット選択・
// ラウンド詳細の距離一覧で共通して使う。左に距離/Markedとエンド構成を縦に、
// 右に的情報を置く1行で、幅375pxでも横にあふれない。的情報は左側のすぐ右に
// 詰め、左側の最小幅（種別ごと）で、行をまたいで的情報の左端をそろえる。
export function DistanceInfo({
  distance,
  isMarked,
  format,
  face,
  arrowsPerEnd,
  totalEnds,
}: {
  distance: number | null;
  isMarked: boolean;
  format: string;
  face: TargetFaceView;
  arrowsPerEnd: number;
  totalEnds: number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className={cn(
          "flex shrink-0 flex-col whitespace-nowrap",
          format === "field" ? "min-w-[7.5rem]" : "min-w-[6.5rem]",
        )}
      >
        <span>
          {[
            distance !== null ? `${distance}m` : null,
            format === "field" ? (isMarked ? "Marked" : "Unmarked") : null,
          ]
            .filter((part): part is string => part !== null)
            .join(" / ")}
        </span>
        <span>
          {arrowsPerEnd}本×{totalEnds}エンド
        </span>
      </div>
      <TargetFaceInfo face={face} />
    </div>
  );
}

export type DistanceInfoItem = {
  key: string | number;
  distance: number | null;
  isMarked: boolean;
  face: TargetFaceView;
  arrowsPerEnd: number;
  totalEnds: number;
};

// 複数の距離情報を縦に並べて描画する。DistanceInfoが的情報を左側のすぐ右に置き、
// 左側に最小幅を持たせるため、行をまたいで的情報の左端が揃う。
function DistanceInfoList({
  items,
  format,
  className,
}: {
  items: DistanceInfoItem[];
  format: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
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
