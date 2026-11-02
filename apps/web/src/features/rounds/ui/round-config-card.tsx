import type { RoundConfig } from "../domain/round-config";
import type { SyncOperation } from "../domain/sync-events";
import { RoundConfigPanel } from "./round-config-panel";

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
