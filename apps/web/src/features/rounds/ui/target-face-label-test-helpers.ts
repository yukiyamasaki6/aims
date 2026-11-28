import { translatorFor } from "@/i18n/translator-test-helpers";
import type { BowTypeOption, FormatOption } from "../domain/round-constants";
import type { PlacementOption } from "../domain/target-face";

const roundsText = translatorFor("rounds");

// 的の説明に出る属性。テストが固定の値で指定し、的のリングからは算出しない。
export type TargetFaceAttributes = {
  format: FormatOption;
  size: number;
  // 説明に並ぶ順で指定する。
  bowTypes: readonly BowTypeOption[];
  minScore: number;
  maxScore: number;
  hasX: boolean;
  tenRadius: number | null;
  placement: PlacementOption;
};

// 接続と操作のテストが、要素の手がかりと期待値にする的の説明を、翻訳キーから組み立てる。
export function targetFaceDescription({
  format,
  size,
  bowTypes,
  minScore,
  maxScore,
  hasX,
  tenRadius,
  placement,
}: TargetFaceAttributes): string {
  const scoring = [
    roundsText("targetFaceScoreRange", {
      min: String(minScore),
      max: String(maxScore),
    }),
    ...(hasX ? [roundsText("targetFaceHasX")] : []),
    ...(tenRadius === null
      ? []
      : [roundsText("targetFaceTenRadius", { radius: String(tenRadius) })]),
  ];
  return roundsText("targetFaceDescription", {
    format: roundsText(`formatOption.${format}`),
    size: String(size),
    bowTypes: bowTypes
      .map((bowType) => roundsText(`bowTypeOption.${bowType}`))
      .join(roundsText("targetFaceBowTypeSeparator")),
    scoring: scoring.join(roundsText("targetFaceScoringSeparator")),
    placement: roundsText(`targetFacePlacement.${placement}`),
  });
}
