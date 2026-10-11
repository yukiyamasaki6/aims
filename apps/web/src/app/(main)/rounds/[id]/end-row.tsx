import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { paleTone, ringColorFor } from "./scorecard-colors";
import type { Pointer } from "./scorecard-input";
import {
  endSubtotal,
  type ScoringTargetFace,
  sortEndShots,
} from "./scorecard-scoring";
import type { Distance, Shot } from "./scorecard-types";

// 場所の最小の幅(玉32px + 左右の余白2pxずつ、玉の間隔は最小4px)と、1段の高さ(行の高さ40px)。
const BALL_SLOT_WIDTH = 36;
const BALL_LINE_HEIGHT = 40;

// 玉の領域の幅から、矢数分の場所が収まる段の数と、1段の場所の数(列の数)を求める。幅を測れるまでは1段とする。
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

// エンド1行。左に番号、右に小計、中に矢数分の場所を等間隔で置く。
// エンドは枠で囲まない。上下の線は親が引き、左右は距離の枠と共通にする。
// 記録済みの玉(点数の高い順)を左の場所から入れ、残りは空白にする。新しい矢を指しているときは最初の空白に仮の矢を出す。
// 指している矢を消した操作が未反映の間は、輪をその玉に残し、仮の矢を出さない。
// 番号・小計は1段分の高さのまま、行全体の上下中央に置く。
export function EndRow({
  distance,
  displayNumber,
  end,
  shots,
  targetFace,
  pointer,
  leavingShotId,
  onSelectShot,
  onSelectEnd,
}: {
  distance: Distance;
  displayNumber: number;
  end: number;
  shots: Shot[];
  targetFace: ScoringTargetFace | undefined;
  pointer: Pointer;
  leavingShotId: string | null;
  onSelectShot: (shot: Shot) => void;
  onSelectEnd: (distance: Distance, end: number) => void;
}) {
  const { ref, lines, columns } = useBallLines(distance.arrows_per_end);
  const endShots = sortEndShots(
    shots.filter((s) => s.distance_id === distance.id && s.end_number === end),
  );
  const subtotal = endSubtotal(endShots);
  const blanks = Math.max(0, distance.arrows_per_end - endShots.length);
  const pointsNew =
    pointer?.kind === "new" &&
    pointer.distanceId === distance.id &&
    pointer.endNumber === end;
  const leaving =
    pointsNew &&
    leavingShotId !== null &&
    endShots.some((s) => s.id === leavingShotId);
  const showProvisional = pointsNew && !leaving;

  return (
    <div
      data-testid={`end-row-${displayNumber}-${end}`}
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
        {endShots.map((shot, index) => {
          const pointed =
            pointer?.kind === "shot" && pointer.shotId === shot.id;
          return (
            <ShotBall
              key={shot.id}
              shot={shot}
              testId={`shot-ball-${displayNumber}-${end}-${index + 1}`}
              pointed={pointed}
              ringed={pointed || (leaving && shot.id === leavingShotId)}
              targetFace={targetFace}
              onSelect={() => onSelectShot(shot)}
            />
          );
        })}
        <EndBlanks
          testIdSuffix={`${displayNumber}-${end}`}
          end={end}
          blanks={blanks}
          filled={endShots.length}
          showProvisional={showProvisional}
          onSelect={() => onSelectEnd(distance, end)}
        />
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

// 記録済みの玉。
function ShotBall({
  shot,
  testId,
  pointed,
  ringed,
  targetFace,
  onSelect,
}: {
  shot: Shot;
  testId: string;
  pointed: boolean;
  ringed: boolean;
  targetFace: ScoringTargetFace | undefined;
  onSelect: () => void;
}) {
  const color = paleTone(ringColorFor(targetFace, shot.score_str));
  return (
    <button
      type="button"
      data-testid={testId}
      data-shot-id={shot.id}
      data-ring={ringed ? "shot" : undefined}
      aria-pressed={pointed}
      onClick={onSelect}
      // 押せる範囲を玉の間隔と行の高さまで広げ、玉は中に置く。
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
          ringed && "outline-2 outline-primary outline-offset-0",
        )}
        style={{ backgroundColor: color.bg, color: color.fg }}
      >
        {shot.score_str}
      </span>
    </button>
  );
}

// エンドの空白の場所。最初の空白だけが押せる大きさで、新しい矢を指しているときは仮の矢を出す。
function EndBlanks({
  testIdSuffix,
  end,
  blanks,
  filled,
  showProvisional,
  onSelect,
}: {
  testIdSuffix: string;
  end: number;
  blanks: number;
  filled: number;
  showProvisional: boolean;
  onSelect: () => void;
}) {
  return (
    <>
      {blanks > 0 && (
        <button
          type="button"
          data-testid={`end-blank-${testIdSuffix}`}
          aria-label={`エンド${end}に追加`}
          data-ring={showProvisional ? "new" : undefined}
          onClick={onSelect}
          className="flex h-10 items-center justify-center"
        >
          {showProvisional && (
            // 指している輪だけを描く。内径は入力済みの玉の直径(size-8)に合わせる。
            <span
              data-testid="provisional-shot"
              className="size-8 shrink-0 rounded-full outline-2 outline-primary outline-offset-0"
            />
          )}
        </button>
      )}
      {Array.from({ length: Math.max(0, blanks - 1) }, (_, i) => {
        const slot = filled + i + 2;
        return (
          <button
            key={`slot-${slot}`}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            data-testid={`end-slot-${testIdSuffix}-${slot}`}
            onClick={onSelect}
            className="h-10"
          />
        );
      })}
    </>
  );
}
