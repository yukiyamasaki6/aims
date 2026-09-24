"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { labelOf } from "./option-label";
import { BOW_TYPE_OPTIONS, FORMAT_OPTIONS } from "./round-constants";
import { TargetFaceInfo, type TargetFaceSpotLayout } from "./target-face-icon";

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
