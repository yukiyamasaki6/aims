import type { RoundConfig } from "../domain/round-config";
import type { Distance } from "../domain/scorecard-types";
import type { TargetFaceOption } from "../domain/target-face";
import { BackToListLink } from "./back-to-list-link";
import { RoundMenu } from "./round-menu";
import { SavePresetDialog } from "./save-preset-dialog";

// 一覧へ戻る・プリセット保存・メニューは常時使えてほしい操作のため、
// スクロール領域（<main>）の外の上端に置く。stickyにせず、行がこの裏に入らない。
export function ScorecardHeaderBar({
  roundId,
  roundConfig,
  distances,
  targetFaces,
}: {
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
