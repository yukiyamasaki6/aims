import { useTranslations } from "next-intl";
import { BOW_TYPE_OPTIONS } from "../domain/round-constants";
import {
  type PlacementOption,
  type TargetFaceOption,
  targetFaceScoring,
} from "../domain/target-face";
import { useOptionLabels } from "./use-option-labels";

// 的の読み上げの説明(種別、サイズ、対応弓種、点数帯と中心、配置)を作る。選択中のボタンと一覧の候補が共有する。
export function useTargetFaceLabel() {
  const t = useTranslations("rounds");
  const { formatLabel, bowTypeLabel } = useOptionLabels();

  const scoringLabel = (face: TargetFaceOption) => {
    const { minScore, maxScore, hasX, tenRadius } = targetFaceScoring(
      face.target_face_spots,
    );
    return [
      t("targetFaceScoreRange", {
        min: String(minScore),
        max: String(maxScore),
      }),
      hasX ? t("targetFaceHasX") : null,
      tenRadius === null
        ? null
        : t("targetFaceTenRadius", { radius: String(tenRadius) }),
    ]
      .filter((part) => part !== null)
      .join(t("targetFaceScoringSeparator"));
  };

  return (face: TargetFaceOption) =>
    t("targetFaceDescription", {
      format: formatLabel(face.format),
      size: String(face.size),
      bowTypes: BOW_TYPE_OPTIONS.filter((value) =>
        face.bow_type.includes(value),
      )
        .map(bowTypeLabel)
        .join(t("targetFaceBowTypeSeparator")),
      scoring: scoringLabel(face),
      placement: t(`targetFacePlacement.${face.placement as PlacementOption}`),
    });
}
