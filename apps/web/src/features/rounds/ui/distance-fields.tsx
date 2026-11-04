"use client";

import { useTranslations } from "next-intl";
import { type Dispatch, type SetStateAction, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  DistanceConfigError,
  DistanceConfigErrors,
  DistanceDraft,
} from "../domain/distance-config";
import type { TargetFaceOption } from "../domain/target-face";
import { TargetFacePicker } from "./target-face-picker";

type LockedField = "arrows" | "total-ends" | "target-face";

// 編集不可の項目を押したときに、その項目の直下へ出す理由。
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
  error,
  locked,
  lockedMessage,
  onLockedPress,
  onChange,
}: {
  label: string;
  slug: string;
  distanceNumber: number;
  value: number | null;
  error: string | undefined;
  locked?: boolean;
  lockedMessage?: boolean;
  onLockedPress?: () => void;
  onChange: (value: number | null) => void;
}) {
  const id = `distance-config-${slug}-${distanceNumber}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        readOnly={locked}
        aria-readonly={locked ? true : undefined}
        aria-describedby={lockedMessage ? `${id}-locked` : undefined}
        onClick={locked ? onLockedPress : undefined}
        className={cn(locked && "cursor-not-allowed opacity-50")}
        data-testid={id}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
        aria-invalid={Boolean(error)}
      />
      {lockedMessage && (
        <LockedMessage id={`${id}-locked`} testId={`${id}-locked-message`} />
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
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
  const errorText = (error: DistanceConfigError | undefined) =>
    error ? t(`distanceConfigError.${error}`) : undefined;
  // 押した編集不可の項目だけに理由を出す。別の項目を押すと移る。
  const [pressedLocked, setPressedLocked] = useState<LockedField | null>(null);
  return (
    <>
      {roundFormat === "field" && (
        <MarkedToggle
          isMarked={draft.isMarked}
          distanceNumber={distanceNumber}
          onChange={(isMarked) => setDraft((d) => ({ ...d, isMarked }))}
        />
      )}

      <NumberField
        label={t("distanceFieldDistance")}
        slug="distance"
        distanceNumber={distanceNumber}
        value={draft.distance}
        error={errorText(fieldErrors.distance)}
        onChange={(v) => setDraft((d) => ({ ...d, distance: v }))}
      />

      <NumberField
        label={t("distanceFieldArrows")}
        slug="arrows"
        distanceNumber={distanceNumber}
        value={draft.arrowsPerEnd}
        error={errorText(fieldErrors.arrowsPerEnd)}
        locked={hasShots}
        lockedMessage={pressedLocked === "arrows"}
        onLockedPress={() => setPressedLocked("arrows")}
        onChange={(v) => setDraft((d) => ({ ...d, arrowsPerEnd: v }))}
      />

      <NumberField
        label={t("distanceFieldTotalEnds")}
        slug="total-ends"
        distanceNumber={distanceNumber}
        value={draft.totalEnds}
        error={errorText(fieldErrors.totalEnds)}
        locked={hasShots}
        lockedMessage={pressedLocked === "total-ends"}
        onLockedPress={() => setPressedLocked("total-ends")}
        onChange={(v) => setDraft((d) => ({ ...d, totalEnds: v }))}
      />

      <TargetFaceField
        distanceNumber={distanceNumber}
        targetFaces={targetFaces}
        selectedId={draft.targetFaceId}
        roundFormat={roundFormat}
        roundBowType={roundBowType}
        onSelect={(id) => setDraft((d) => ({ ...d, targetFaceId: id }))}
        locked={hasShots}
        showLockedMessage={pressedLocked === "target-face"}
        onLockedPress={() => setPressedLocked("target-face")}
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
