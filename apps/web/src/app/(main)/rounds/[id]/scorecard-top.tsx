import type { IdentityReader, SessionReader } from "@/features/auth";
import type { RoundConfig } from "@/features/rounds/round-config";
import type { summarizeRound } from "@/features/rounds/scorecard-scoring";
import type { Distance } from "@/features/rounds/scorecard-types";
import type { SyncOperation } from "@/features/rounds/sync-events";
import type { TargetFaceOption } from "@/features/rounds/target-face-types";
import { BackToListLink } from "./back-to-list-link";
import { RoundConfigPanel } from "./round-config-panel";
import { RoundMenu } from "./round-menu";
import { SavePresetDialog } from "./save-preset-dialog";

// 一覧へ戻る・プリセット保存・メニューは常時使えてほしい操作のため、
// スクロール領域（<main>）の外の上端に置く。stickyにせず、行がこの裏に入らない。
export function ScorecardHeaderBar({
  sessionReader,
  identityReader,
  roundId,
  roundConfig,
  distances,
  targetFaces,
}: {
  sessionReader: SessionReader;
  identityReader: IdentityReader;
  roundId: string;
  roundConfig: RoundConfig;
  distances: Distance[];
  targetFaces: TargetFaceOption[];
}) {
  return (
    <div className="grid h-14 shrink-0 grid-cols-[auto_1fr] items-center gap-2 bg-card px-8">
      <BackToListLink />
      <div className="flex items-center justify-end gap-2">
        <SavePresetDialog
          sessionReader={sessionReader}
          identityReader={identityReader}
          roundName={roundConfig.name}
          format={roundConfig.format}
          bowType={roundConfig.bowType}
          distances={distances}
          targetFaces={targetFaces}
        />
        <RoundMenu roundId={roundId} />
      </div>
    </div>
  );
}

// ラウンドの設定のカード。
// 下端は合計バーと接する内部の継ぎ目のため、shadowが下方向へ滲まないよう、上・左・右にはみ出す分だけをclip-pathで残す（距離情報のトグルボタンと同じ考え方）。
export function RoundConfigCard({
  roundId,
  roundConfig,
  defaultExpanded,
  hasUnmarkedDistances,
  enqueue,
}: {
  roundId: string;
  roundConfig: RoundConfig;
  defaultExpanded: boolean;
  hasUnmarkedDistances: boolean;
  enqueue: (operation: SyncOperation) => void;
}) {
  return (
    <div className="rounded-t-xl border-x border-t bg-card text-card-foreground shadow-sm [clip-path:inset(-8px_-8px_0_-8px)]">
      <RoundConfigPanel
        roundId={roundId}
        initial={roundConfig}
        defaultExpanded={defaultExpanded}
        hasUnmarkedDistances={hasUnmarkedDistances}
        enqueue={enqueue}
      />
    </div>
  );
}

// 合計バー。
// position: stickyは直接の親の高さの範囲でしか張り付かないため、
// RoundConfigPanelと同じ小さいカードの中に置くと、そのカードの
// 高さを過ぎた時点で張り付きが外れてしまう（1つのdivに包む案は
// 実測で確認済み：張り付きが外れる）。見た目は直前のカードと
// 継ぎ目なく繋がって見えるよう角丸・枠線・-mt-6（親のgap-6を打ち
// 消す）で調整しつつ、DOM上はこのページ全体（distances一覧を含む
// flex-colコンテナ）の直接の子にすることで、ページ全体をスクロール
// している間ずっと張り付くようにする。RoundConfigPanel側と合わせて
// 1枚の結合カードに見せているため、この合計バー自身の外周（左右・
// 下端）にもshadowが必要（RoundConfigPanel側のshadowは自分自身の
// 外周にしかかからず、この合計バーの下端側は覆えない）。区切り線は
// RoundConfigPanel側のborder-bが持ち、この合計バー自体は
// border-topを持たない。上端はRoundConfigPanelと接する内部の
// 継ぎ目のため、shadowが上方向へ滲まないようclip-pathで下・左・右
// にはみ出す分だけを残す。
export function RoundSummaryBar({
  roundSummary,
}: {
  roundSummary: ReturnType<typeof summarizeRound>;
}) {
  return (
    <div
      data-testid="round-summary"
      data-sticky-inset
      className="-mt-6 sticky top-0 z-20 flex items-baseline justify-end gap-2 rounded-b-xl border bg-card px-3 py-2 shadow-sm [clip-path:inset(0_-8px_-8px_-8px)]"
    >
      <div className="flex items-baseline gap-2">
        {roundSummary.topScores && (
          <span
            data-testid="round-top-scores"
            className="text-muted-foreground text-sm"
          >
            {roundSummary.topScores.firstLabel}:{" "}
            {roundSummary.topScores.firstCount} /{" "}
            {roundSummary.topScores.secondLabel}:{" "}
            {roundSummary.topScores.secondCount}
          </span>
        )}
        <span className="font-heading text-lg font-semibold">
          合計{roundSummary.total}
        </span>
      </div>
    </div>
  );
}
