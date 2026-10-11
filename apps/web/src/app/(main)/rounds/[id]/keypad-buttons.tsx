import { Redo, Undo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { contrastText } from "./scorecard-colors";
import type { Pointer } from "./scorecard-input";
import { type ScoringTargetFace, scoreKeysFor } from "./scorecard-scoring";
import type { Distance } from "./scorecard-types";
import type { ScoreHistory } from "./use-score-history";
import type { ShotInput } from "./use-shot-input";

// テンキーの中身。戻す・進む・クリアの行と、指している矢の距離の的の点数のキー。
export function KeypadButtons({
  keypadDistance,
  targetFaces,
  pointer,
  history,
  input,
}: {
  keypadDistance: Distance | null;
  targetFaces: ScoringTargetFace[];
  pointer: Pointer;
  history: ScoreHistory;
  input: ShotInput;
}) {
  if (!keypadDistance) return null;
  const targetFace = targetFaces.find(
    (f) => f.id === keypadDistance.target_face_id,
  );
  return (
    <>
      <div className="grid grid-cols-4 gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="col-span-2 h-12"
          disabled={!history.canUndo}
          data-testid="score-button-undo"
          aria-label="一つ戻る"
          onClick={input.handleUndo}
        >
          <Undo />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-12"
          disabled={!history.canRedo}
          data-testid="score-button-redo"
          aria-label="一つ進む"
          onClick={input.handleRedo}
        >
          <Redo />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-12 text-lg"
          disabled={pointer?.kind !== "shot"}
          data-testid="score-button-clear"
          aria-label="クリア"
          onClick={input.handleClear}
        >
          C
        </Button>
      </div>
      <ScoreKeys targetFace={targetFace} onScore={input.handleScore} />
    </>
  );
}

function ScoreKeys({
  targetFace,
  onScore,
}: {
  targetFace: ScoringTargetFace | undefined;
  onScore: (scoreStr: string, scoreInt: number) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {scoreKeysFor(targetFace).map((b) => (
        <Button
          key={b.scoreStr}
          type="button"
          variant="outline"
          size="lg"
          data-testid={`score-button-${b.scoreStr}`}
          onClick={() => onScore(b.scoreStr, b.scoreInt)}
          // 背景色をstyleで直接指定するとhover:bg-muted等のクラスは
          // 上書きされて効かなくなる。brightnessフィルターは黒（#231F20）
          // のような暗い色では変化が知覚できないため、明暗どちらの背景
          // でも均一に視認できるグレー半透明のオーバーレイをinset
          // box-shadowで重ねてホバー/押下の視覚フィードバックとする。
          // 玉（issue #155）はpaleTone()で明度90%に統一された薄い
          // 背景のためMaterial Designのstate layerの目安（8%/12%）で
          // 十分だが、テンキーは彩度の高いベタ色のため同じ%では変化が
          // 知覚できず、実測で確認の上より強い不透明度にしている
          // （issue #286で他の対話的要素の基準を検討する際に再考）。
          // 高さ・文字サイズはタッチターゲット推奨（44〜48px目安）に
          // 合わせてh-12・text-lgへ引き上げる。PCもテンキーとしての
          // 押しやすさ・視認性を優先し、PCの他ボタン（lg標準のh-9）
          // より大きいこの値で統一する。
          className="h-12 text-lg transition-shadow hover:shadow-[inset_0_0_0_999px_rgba(128,128,128,0.25)] active:shadow-[inset_0_0_0_999px_rgba(128,128,128,0.35)]"
          style={{
            backgroundColor: b.color,
            color: contrastText(b.color),
          }}
        >
          {b.scoreStr}
        </Button>
      ))}
    </div>
  );
}
