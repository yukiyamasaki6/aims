"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { TargetFaceView } from "../domain/target-face";
import { TargetSlot } from "./history-target-selection";
import { TargetFaceInfo } from "./target-face-info";
import { useOptionLabels } from "./use-option-labels";

// 1行目の文字列。フィールドは区分を先に置き、距離を括弧で添える（例: `Marked (90m)`）。
// 距離が無ければ区分のみ、フィールド以外は距離のみにする。
// kindは、Marked・Unmarkedの表示名。
function distanceLabel(
  kind: string,
  distance: number | null,
  format: string,
): string {
  if (format !== "field") return distance !== null ? `${distance}m` : "";
  return distance !== null ? `${kind} (${distance}m)` : kind;
}

// 距離1件分の情報表示（Marked/距離・的情報・エンド構成）。プリセット選択・
// ラウンド詳細の距離一覧、履歴の絞り込む距離の要約で共通して使う。左にMarked/距離とエンド構成を縦に、
// 右に的情報を置く1行で、幅375pxでも横にあふれない。的情報は左側のすぐ右に
// 詰め、左側の最小幅で、行をまたいで的情報の左端をそろえる。
// 履歴の要約だけが、射数/エンド・総エンド数・的を持たない(null)。射数/エンドがnullなら
// エンド構成の行を出さず、総エンド数がnullなら射数/エンドだけを出し、的がnullなら
// 同じ寸法の領域に「指定なし」を出す。
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
  face: TargetFaceView | null;
  arrowsPerEnd: number | null;
  totalEnds: number | null;
}) {
  const t = useTranslations("rounds");
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex min-w-[7.5rem] shrink-0 flex-col whitespace-nowrap">
        <span>
          {distanceLabel(
            t(isMarked ? "distanceMarked" : "distanceUnmarked"),
            distance,
            format,
          )}
        </span>
        {arrowsPerEnd !== null && (
          <span>
            {totalEnds === null
              ? t("distanceArrowsPerEnd", {
                  arrowsPerEnd: String(arrowsPerEnd),
                })
              : t("distanceEnds", {
                  arrowsPerEnd: String(arrowsPerEnd),
                  totalEnds: String(totalEnds),
                })}
          </span>
        )}
      </div>
      {face === null ? (
        <TargetSlot>
          <span className="text-muted-foreground">
            {t("historyFilterNone")}
          </span>
        </TargetSlot>
      ) : (
        <TargetFaceInfo face={face} />
      )}
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
  const t = useTranslations("rounds");
  const { formatLabel, bowTypeLabel } = useOptionLabels();
  return (
    <div className="flex flex-col gap-2 text-sm">
      <span data-testid="round-preset-format-bow-type">
        {t("formatBowType", {
          format: formatLabel(format),
          bowType: bowTypeLabel(bowType),
        })}
      </span>
      <DistanceInfoList format={format} items={distances} />
    </div>
  );
}
