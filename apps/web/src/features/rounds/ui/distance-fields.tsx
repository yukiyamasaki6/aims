"use client";

import { useTranslations } from "next-intl";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  DistanceConfigErrors,
  DistanceDraft,
} from "../domain/distance-config";
import { DISTANCE_LIMITS } from "../domain/round-constants";
import type { TargetFaceOption } from "../domain/target-face";
import { TargetFacePicker } from "./target-face-picker";

// 編集不可の的を押したときに、的の直下へ出す理由。
function LockedMessage({ id, testId }: { id: string; testId: string }) {
  const t = useTranslations("rounds");
  return (
    <p
      id={id}
      role="alert"
      data-testid={testId}
      className="text-muted-foreground text-sm"
    >
      {t("distanceLocked")}
    </p>
  );
}

const MARKED_OPTIONS = [
  { value: true, key: "marked" },
  { value: false, key: "unmarked" },
] as const;

// 距離1件分の編集フォームの数値入力欄。空欄はnullとして扱う。
function NumberField({
  label,
  slug,
  distanceNumber,
  value,
  max,
  error,
  unfitId,
  children,
  onChange,
}: {
  label: string;
  slug: string;
  distanceNumber: number;
  value: number | null;
  max: number;
  error: "required" | "notPositiveInteger" | "tooLarge" | undefined;
  // 項目の値そのものの誤りでなく、他の項目との組で起きる誤りの説明の要素のid。あるとき、項目を誤りとして示し、説明に結ぶ。
  unfitId?: string;
  children?: ReactNode;
  onChange: (value: number | null) => void;
}) {
  const id = `distance-config-${slug}-${distanceNumber}`;
  const errorText = useErrorText()(error, max);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        max={max}
        aria-describedby={unfitId}
        data-testid={id}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
        aria-invalid={Boolean(errorText) || unfitId !== undefined}
      />
      {errorText && <p className="text-destructive text-sm">{errorText}</p>}
      {children}
    </div>
  );
}

function TargetFaceField({
  distanceNumber,
  targetFaces,
  selectedId,
  roundFormat,
  roundBowType,
  onSelect,
  locked,
  showLockedMessage,
  onLockedPress,
}: {
  distanceNumber: number;
  targetFaces: TargetFaceOption[];
  selectedId: string;
  roundFormat: string;
  roundBowType: string;
  onSelect: (id: string) => void;
  locked: boolean;
  showLockedMessage: boolean;
  onLockedPress: () => void;
}) {
  const t = useTranslations("rounds");
  const messageId = `distance-config-target-face-locked-${distanceNumber}`;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">
        {t("distanceTargetFace")}
      </span>
      <TargetFacePicker
        targetFaces={targetFaces}
        selectedId={selectedId}
        roundFormat={roundFormat}
        roundBowType={roundBowType}
        onSelect={onSelect}
        locked={locked}
        onLockedPress={onLockedPress}
        describedBy={showLockedMessage ? messageId : undefined}
      />
      {showLockedMessage && (
        <LockedMessage
          id={messageId}
          testId="distance-config-target-face-locked-message"
        />
      )}
    </div>
  );
}

// 検証の誤りの種類を、項目の下に出す文言にする。
function useErrorText() {
  const t = useTranslations("rounds");
  return (
    error: "required" | "notPositiveInteger" | "tooLarge" | undefined,
    max: number,
  ) => {
    if (error === "tooLarge") {
      return t("distanceConfigError.tooLarge", { max: String(max) });
    }
    return error ? t(`distanceConfigError.${error}`) : undefined;
  };
}

// 総エンド数・本数が記録済みの矢に収まらないときの理由。
function ShotsUnfitMessage({ id }: { id: string }) {
  const t = useTranslations("rounds");
  return (
    <p
      id={id}
      role="alert"
      data-testid={id}
      className="text-destructive text-sm"
    >
      {t("distanceConfigError.shotsUnfit")}
    </p>
  );
}

export function DistanceFields({
  distanceNumber,
  draft,
  setDraft,
  fieldErrors,
  targetFaces,
  roundFormat,
  roundBowType,
  hasShots,
}: {
  distanceNumber: number;
  draft: DistanceDraft;
  setDraft: Dispatch<SetStateAction<DistanceDraft>>;
  fieldErrors: DistanceConfigErrors;
  targetFaces: TargetFaceOption[];
  roundFormat: string;
  roundBowType: string;
  hasShots: boolean;
}) {
  const t = useTranslations("rounds");
  // 編集不可の的を押したときだけ、的の直下に理由を出す。
  const [targetFaceLockedPressed, setTargetFaceLockedPressed] = useState(false);
  // 総エンド数・本数が記録済みの矢に収まらないときの理由は、総エンド数の直下に1つ出し、本数からも参照する。
  const unfitId = `distance-config-shots-unfit-${distanceNumber}`;
  const unfitShown = fieldErrors.shotsUnfit !== undefined;
  return (
    <>
      {roundFormat === "field" && (
        <MarkedToggle
          isMarked={draft.is_marked}
          distanceNumber={distanceNumber}
          onChange={(marked) => setDraft((d) => ({ ...d, is_marked: marked }))}
        />
      )}

      <NumberField
        label={t("distanceFieldDistance")}
        slug="distance"
        distanceNumber={distanceNumber}
        value={draft.distance}
        max={DISTANCE_LIMITS.distance}
        error={fieldErrors.distance}
        onChange={(v) => setDraft((d) => ({ ...d, distance: v }))}
      />

      <NumberField
        label={t("distanceFieldArrows")}
        slug="arrows"
        distanceNumber={distanceNumber}
        value={draft.arrows_per_end}
        max={DISTANCE_LIMITS.arrowsPerEnd}
        error={fieldErrors.arrowsPerEnd}
        unfitId={unfitShown ? unfitId : undefined}
        onChange={(v) => setDraft((d) => ({ ...d, arrows_per_end: v }))}
      />

      <NumberField
        label={t("distanceFieldTotalEnds")}
        slug="total-ends"
        distanceNumber={distanceNumber}
        value={draft.total_ends}
        max={DISTANCE_LIMITS.totalEnds}
        error={fieldErrors.totalEnds}
        unfitId={unfitShown ? unfitId : undefined}
        onChange={(v) => setDraft((d) => ({ ...d, total_ends: v }))}
      >
        {unfitShown && <ShotsUnfitMessage id={unfitId} />}
      </NumberField>

      <TargetFaceField
        distanceNumber={distanceNumber}
        targetFaces={targetFaces}
        selectedId={draft.target_face_id}
        roundFormat={roundFormat}
        roundBowType={roundBowType}
        onSelect={(id) => setDraft((d) => ({ ...d, target_face_id: id }))}
        locked={hasShots}
        showLockedMessage={targetFaceLockedPressed}
        onLockedPress={() => setTargetFaceLockedPressed(true)}
      />
    </>
  );
}

function MarkedToggle({
  isMarked,
  distanceNumber,
  onChange,
}: {
  isMarked: boolean;
  distanceNumber: number;
  onChange: (isMarked: boolean) => void;
}) {
  const t = useTranslations("rounds");
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">
        {t("distanceMarkedToggle")}
      </span>
      <div className="grid grid-cols-2 gap-2">
        {MARKED_OPTIONS.map((o) => (
          <Button
            key={String(o.value)}
            type="button"
            variant={isMarked === o.value ? "default" : "outline"}
            size="sm"
            data-testid={`distance-config-${o.key}-${distanceNumber}`}
            onClick={() => onChange(o.value)}
          >
            {t(o.key === "marked" ? "distanceMarked" : "distanceUnmarked")}
          </Button>
        ))}
      </div>
    </div>
  );
}
