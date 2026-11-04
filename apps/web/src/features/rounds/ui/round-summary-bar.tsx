import { useTranslations } from "next-intl";
import type { summarizeRound } from "../domain/scorecard-scoring";

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
  const t = useTranslations("rounds");
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
            {t("topScores", {
              firstLabel: roundSummary.topScores.firstLabel,
              firstCount: String(roundSummary.topScores.firstCount),
              secondLabel: roundSummary.topScores.secondLabel,
              secondCount: String(roundSummary.topScores.secondCount),
            })}
          </span>
        )}
        <span className="font-heading text-lg font-semibold">
          {t("roundTotal", { total: String(roundSummary.total) })}
        </span>
      </div>
    </div>
  );
}
