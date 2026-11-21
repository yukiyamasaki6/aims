import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ringColorFor } from "../domain/ring-color";
import {
  endSubtotal,
  type ScoringTargetFace,
} from "../domain/scorecard-scoring";
import type { Distance, Shot } from "../domain/scorecard-types";
import { isSameCell, type ShotCell, shotAt } from "../domain/shot-cell";
import type { Pointer } from "../domain/shot-pointer";
import { paleTone } from "./color-tone";
import { followRowKey } from "./scroll-to-pointer";

// 場所の最小の幅(玉32px + 左右の余白2pxずつ、玉の間隔は最小4px)と、1段の高さ(行の高さ40px)。
const BALL_SLOT_WIDTH = 36;
const BALL_LINE_HEIGHT = 40;

// 玉の領域の幅から、射数/エンド分の場所が収まる段の数と、1段の場所の数(列の数)を求める。幅を測れるまでは1段とする。
// 同じ距離の行は同じ幅のため、段の数は距離の中で揃う。
function useBallLines(arrows: number) {
  const [width, setWidth] = useState(0);
  const ref = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const perLine = Math.max(1, Math.floor(width / BALL_SLOT_WIDTH));
  const lines = width > 0 ? Math.ceil(arrows / perLine) : 1;
  return { ref, lines, columns: Math.ceil(arrows / lines) };
}

// エンド1行。左に番号、右に小計、中に射数/エンド個のマスを番号順に固定で等間隔に置く。
// エンドは枠で囲まない。上下の線は親が引き、左右は距離の枠と共通にする。
// 記録済みのマスは点数の玉、空のマスは灰色の細い輪(番号の文字は描かない)で描き、指しているマスには輪を付ける。
// 番号・小計は1段分の高さのまま、行全体の上下中央に置く。
export function EndRow({
  distance,
  displayNumber,
  end,
  shots,
  targetFace,
  pointer,
  onSelectCell,
  onLinesChange,
}: {
  distance: Distance;
  displayNumber: number;
  end: number;
  shots: Shot[];
  targetFace: ScoringTargetFace | undefined;
  pointer: Pointer;
  onSelectCell: (cell: ShotCell) => void;
  // 段の数が変わったときに呼ぶ。行の高さが変わり、指す行の位置がずれるため。
  onLinesChange: () => void;
}) {
  const { ref, lines, columns } = useBallLines(distance.arrows_per_end);
  const previousLines = useRef(lines);
  useEffect(() => {
    if (previousLines.current === lines) return;
    previousLines.current = lines;
    onLinesChange();
  }, [lines, onLinesChange]);
  const endShots = shots.filter(
    (s) => s.distance_id === distance.id && s.end_number === end,
  );
  const subtotal = endSubtotal(endShots);

  return (
    <div
      data-testid={`end-row-${displayNumber}-${end}`}
      data-follow-row={followRowKey(distance.id, end)}
      className="flex items-center gap-0.5"
    >
      <div className="flex h-10 w-5 shrink-0 items-center justify-center text-muted-foreground text-xs">
        {end}
      </div>
      <div
        ref={ref}
        className="relative grid min-w-0 flex-1"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          minHeight: lines * BALL_LINE_HEIGHT,
        }}
      >
        {Array.from({ length: distance.arrows_per_end }, (_, i) => {
          const cell = {
            distanceId: distance.id,
            endNumber: end,
            shotNumber: i + 1,
          };
          return (
            <CellButton
              key={cell.shotNumber}
              cell={cell}
              testId={`shot-cell-${displayNumber}-${end}-${cell.shotNumber}`}
              shot={shotAt(endShots, cell)}
              pointed={pointer !== null && isSameCell(pointer, cell)}
              targetFace={targetFace}
              onSelect={() => onSelectCell(cell)}
            />
          );
        })}
      </div>
      <div
        data-testid={`end-subtotal-${displayNumber}-${end}`}
        className="flex h-10 w-8 shrink-0 items-center justify-center text-muted-foreground text-base"
      >
        {subtotal ?? ""}
      </div>
    </div>
  );
}

// マス1つ。記録済みなら点数の玉、空なら灰色の細い輪(番号の文字は描かず、読み上げの名前で番号を伝える)。
// 押せる範囲を玉の間隔と行の高さまで広げ、玉と輪は中に置く。
function CellButton({
  cell,
  testId,
  shot,
  pointed,
  targetFace,
  onSelect,
}: {
  cell: ShotCell;
  testId: string;
  shot: Shot | undefined;
  pointed: boolean;
  targetFace: ScoringTargetFace | undefined;
  onSelect: () => void;
}) {
  const t = useTranslations("rounds");
  const color = shot
    ? paleTone(ringColorFor(targetFace, shot.score_str))
    : undefined;
  return (
    <button
      type="button"
      data-testid={testId}
      data-ring={pointed ? "cell" : undefined}
      data-empty={shot ? undefined : "true"}
      aria-pressed={pointed}
      aria-label={
        shot ? undefined : t("emptyCell", { number: String(cell.shotNumber) })
      }
      onClick={onSelect}
      className="group flex h-10 w-9 items-center justify-center justify-self-center"
    >
      <span
        className={cn(
          // 得点色をstyleで直接指定するため、hover:bg-muted等のクラスは
          // 常にそのstyleに上書きされて効かない（テンキーと同じ問題、
          // issue #155）。明暗どちらの背景色でも均一に視認できる
          // グレー半透明のオーバーレイをinset box-shadowで重ねて
          // ホバー/押下の視覚フィードバックとする。不透明度は
          // Material Designのstate layerの目安（hover 8%/pressed
          // 12%）に合わせる（issue #286で他の対話的要素も含めて
          // 同じ基準に揃える予定）。
          "flex size-8 items-center justify-center rounded-full text-base font-medium transition-shadow group-hover:shadow-[inset_0_0_0_999px_rgba(128,128,128,0.08)] group-active:shadow-[inset_0_0_0_999px_rgba(128,128,128,0.12)]",
          !shot && "border border-muted-foreground/40",
          pointed &&
            (shot
              ? "outline-2 outline-primary outline-offset-0"
              : "border-transparent outline-2 outline-primary outline-offset-0"),
        )}
        style={
          color ? { backgroundColor: color.bg, color: color.fg } : undefined
        }
      >
        {shot?.score_str}
      </span>
    </button>
  );
}
