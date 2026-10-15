import { ChevronRight } from "lucide-react";
import {
  distanceNumber,
  summarizeDistance,
} from "@/features/rounds/scorecard-scoring";
import type { Distance, Shot } from "@/features/rounds/scorecard-types";
import type { SyncOperation } from "@/features/rounds/sync-events";
import type { TargetFaceOption } from "@/features/rounds/target-face-types";
import { cn } from "@/lib/utils";
import { DistanceInfo } from "../_shared/preset-info";
import { lookupTargetFace } from "../_shared/target-face-icon";
import type { DistanceConfig } from "./distance-config";
import { DistanceEditFields } from "./distance-config-row";
import { EndRow } from "./end-row";
import type { Pointer } from "./scorecard-input";

type DistanceSummary = ReturnType<typeof summarizeDistance>;

// 距離1件分のカード。ヘッダー（トグル）、編集フォーム、小計、エンドの行。
export function DistanceSection({
  distance: d,
  distances,
  shots,
  targetFaces,
  roundFormat,
  roundBowType,
  editing,
  hasShots,
  pointer,
  leavingShotId,
  onToggleEditing,
  onSaved,
  onDeleted,
  enqueue,
  onSelectShot,
  onSelectEnd,
}: {
  distance: Distance;
  distances: Distance[];
  shots: Shot[];
  targetFaces: TargetFaceOption[];
  roundFormat: string;
  roundBowType: string;
  editing: boolean;
  hasShots: boolean;
  pointer: Pointer;
  leavingShotId: string | null;
  onToggleEditing: () => void;
  onSaved: (updated: DistanceConfig) => void;
  onDeleted: () => void;
  enqueue: (operation: SyncOperation) => void;
  onSelectShot: (shot: Shot) => void;
  onSelectEnd: (distance: Distance, end: number) => void;
}) {
  const displayNumber = distanceNumber(distances, d.id);
  const face = targetFaces.find((f) => f.id === d.target_face_id);

  // end行1件分の描画。最終行だけ小計のsticky境界（下記の内側
  // ラッパー）の外に出すため、共通化して2箇所から呼べるようにする。
  const renderEndRow = (end: number) => (
    <EndRow
      key={end}
      distance={d}
      displayNumber={displayNumber}
      end={end}
      shots={shots}
      targetFace={face}
      pointer={pointer}
      leavingShotId={leavingShotId}
      onSelectShot={onSelectShot}
      onSelectEnd={onSelectEnd}
    />
  );

  return (
    <div
      data-testid={`distance-summary-${displayNumber}`}
      className="rounded-xl border bg-card text-card-foreground shadow-sm"
    >
      {/* 小計のsticky境界（position: stickyの直接の親）を最終行の
      手前までにするため、トグル・編集・小計・最終行以外の
      end行をこの内側ラッパーにまとめる。これにより、最終行は
      この親の外（下記の兄弟div）に置かれ、小計はこの親の下端
      ＝最終行の手前でstickyが自然に外れる。 */}
      <div>
        <DistanceToggle
          distance={d}
          displayNumber={displayNumber}
          roundFormat={roundFormat}
          targetFaces={targetFaces}
          onToggle={onToggleEditing}
        />
        {editing && (
          <DistanceEditFields
            distance={toDistanceConfig(d, displayNumber)}
            hasShots={hasShots}
            targetFaces={targetFaces}
            roundFormat={roundFormat}
            roundBowType={roundBowType}
            onSaved={onSaved}
            onDeleted={onDeleted}
            onOpenChange={onToggleEditing}
            enqueue={enqueue}
          />
        )}
        <DistanceSubtotalBar
          displayNumber={displayNumber}
          summary={summarizeDistance(d.id, face, shots)}
        />
        {d.total_ends > 1 && (
          <div className="divide-y">
            {Array.from({ length: d.total_ends - 1 }, (_, i) => i + 1).map(
              (end) => renderEndRow(end),
            )}
          </div>
        )}
      </div>
      {/* 最終行だけを小計のsticky境界の外に出す。border-tは1〜N-1行目との
      間の区切り線(divide-yと同じ線)。1エンドのときは小計のborder-bが
      上の線になるため引かない。行の端に背景を持つ要素が無いため、
      カードの角で切るoverflow-hiddenは付けない(付けるとstickyの基準が変わる)。 */}
      <div className={cn(d.total_ends > 1 && "border-t")}>
        {renderEndRow(d.total_ends)}
      </div>
    </div>
  );
}

// 小計（sticky、z-10）が-mt-3.5でこのボタンの下paddingへ
// 食い込むため、区切り線として持たせるこのborder-bが
// その小計自身の背景に覆われて見えなくならないよう、
// 小計より高いz-indexにしておく（食い込むのは余白部分
// のみで、この線自体は隠れない）。ただし合計バー
// （z-20）より高くしてしまうと、スクロールでこのボタン
// が画面上部を通過する瞬間に合計バー自体を覆ってしまう
// ため、小計(10)＜このボタン(15)＜合計(20)の順にする。
// このカード自体の丸角（rounded-xl）がこのボタンの
// 不透明な背景で隠れないよう、上端もrounded-t-xlで
// 揃える。
function DistanceToggle({
  distance: d,
  displayNumber,
  roundFormat,
  targetFaces,
  onToggle,
}: {
  distance: Distance;
  displayNumber: number;
  roundFormat: string;
  targetFaces: TargetFaceOption[];
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`distance-config-toggle-${displayNumber}`}
      onClick={onToggle}
      className="relative z-[15] flex w-full items-center gap-1 rounded-t-xl border-b bg-card px-3 py-2 text-left text-muted-foreground text-sm"
    >
      <DistanceInfo
        distance={d.distance}
        isMarked={d.is_marked}
        format={roundFormat}
        face={lookupTargetFace(targetFaces, d.target_face_id)}
        arrowsPerEnd={d.arrows_per_end}
        totalEnds={d.total_ends}
      />
      <ChevronRight className="ml-auto size-4 shrink-0" />
    </button>
  );
}

// 常に上（トグルボタンの余っている下paddingの中）に食い込ま
// せておく（-mt-3.5、合計バーの丸みの半径分）。上端は枠線を
// 持たせず、区切り線はトグルボタン側のborder-bが担う。これに
// より通常表示時はトグルボタンの余白に、スクロールで合計バー
// の下に張り付いた時は合計バー自身に、それぞれ自然に隠れる
// ため、「張り付いている時だけ隙間ができない」ための余白が
// どの状態でも無駄な空白に見えない（JS判定不要）。食い込む分
// だけ上のpaddingを増やし、テキストが隠れないようにする。
// この小計の親（この内側ラッパー）が最終行を含まないため、
// 最終行の手前でstickyが自然に外れる。
function DistanceSubtotalBar({
  displayNumber,
  summary,
}: {
  displayNumber: number;
  summary: DistanceSummary;
}) {
  return (
    <div
      data-sticky-inset
      className="-mt-3.5 sticky top-8 z-10 flex items-baseline justify-end gap-2 border-b bg-card px-3 pt-6 pb-2 text-muted-foreground text-xs"
    >
      {summary.topScores && (
        <span data-testid={`distance-top-scores-${displayNumber}`}>
          {summary.topScores.firstLabel}: {summary.topScores.firstCount} /{" "}
          {summary.topScores.secondLabel}: {summary.topScores.secondCount}
        </span>
      )}
      <span className="text-foreground text-sm font-semibold">
        小計{summary.total}
      </span>
    </div>
  );
}

function toDistanceConfig(d: Distance, displayNumber: number): DistanceConfig {
  return {
    id: d.id,
    distanceNumber: displayNumber,
    distance: d.distance,
    totalEnds: d.total_ends,
    arrowsPerEnd: d.arrows_per_end,
    targetFaceId: d.target_face_id,
    isMarked: d.is_marked,
  };
}
