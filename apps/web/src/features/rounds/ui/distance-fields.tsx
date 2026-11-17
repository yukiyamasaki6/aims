"use client";

import { useTranslations } from "next-intl";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useState,
} from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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

// 距離1件分の編集フォームの数値入力欄。空欄はnullとして扱う。誤りの文言は、欄を含む行の下に、行が出す。
function NumberField({
  label,
  slug,
  distanceNumber,
  value,
  max,
  invalid,
  unfitId,
  onChange,
}: {
  label: string;
  slug: string;
  distanceNumber: number;
  value: number | null;
  max: number;
  invalid: boolean;
  // 項目の値そのものの誤りでなく、他の項目との組で起きる誤りの説明の要素のid。あるとき、項目を誤りとして示し、説明に結ぶ。
  unfitId?: string;
  onChange: (value: number | null) => void;
}) {
  const id = `distance-config-${slug}-${distanceNumber}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
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
        aria-invalid={invalid || unfitId !== undefined}
      />
    </div>
  );
}

// 横に並べる欄の行。誤りの文言は、行の下に幅いっぱいで出す。
function FieldRow({
  columns,
  errors,
  children,
}: {
  columns: 1 | 2;
  errors: readonly (string | undefined)[];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className={columns === 2 ? "grid grid-cols-2 gap-2" : "grid gap-2"}>
        {children}
      </div>
      {errors.map(
        (error) =>
          error && (
            <p key={error} className="text-destructive text-sm">
              {error}
            </p>
          ),
      )}
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

// 総エンド数・射数/エンドが記録済みの矢に収まらないときの理由。
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

type RowProps = {
  distanceNumber: number;
  draft: DistanceDraft;
  setDraft: Dispatch<SetStateAction<DistanceDraft>>;
  fieldErrors: DistanceConfigErrors;
};

// 1行目。フィールドはMarked/Unmarkedと距離の2列、フィールド以外は距離が幅いっぱい。
function DistanceRow({
  distanceNumber,
  draft,
  setDraft,
  fieldErrors,
  isField,
}: RowProps & { isField: boolean }) {
  const t = useTranslations("rounds");
  const errorText = useErrorText();
  return (
    <FieldRow
      columns={isField ? 2 : 1}
      errors={[errorText(fieldErrors.distance, DISTANCE_LIMITS.distance)]}
    >
      {isField && (
        <MarkedSelect
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
        invalid={fieldErrors.distance !== undefined}
        onChange={(v) => setDraft((d) => ({ ...d, distance: v }))}
      />
    </FieldRow>
  );
}

// 2行目。射数/エンドと総エンド数の2列。記録済みの矢に収まらない理由は、行の下に幅いっぱいで1つ出し、2つの欄から参照する。
function CountsRow({ distanceNumber, draft, setDraft, fieldErrors }: RowProps) {
  const t = useTranslations("rounds");
  const errorText = useErrorText();
  const unfitId = `distance-config-shots-unfit-${distanceNumber}`;
  const unfitShown = fieldErrors.shotsUnfit !== undefined;
  return (
    <>
      <FieldRow
        columns={2}
        errors={[
          errorText(fieldErrors.arrowsPerEnd, DISTANCE_LIMITS.arrowsPerEnd),
          errorText(fieldErrors.totalEnds, DISTANCE_LIMITS.totalEnds),
        ]}
      >
        <NumberField
          label={t("distanceFieldArrows")}
          slug="arrows"
          distanceNumber={distanceNumber}
          value={draft.arrows_per_end}
          max={DISTANCE_LIMITS.arrowsPerEnd}
          invalid={fieldErrors.arrowsPerEnd !== undefined}
          unfitId={unfitShown ? unfitId : undefined}
          onChange={(v) => setDraft((d) => ({ ...d, arrows_per_end: v }))}
        />
        <NumberField
          label={t("distanceFieldTotalEnds")}
          slug="total-ends"
          distanceNumber={distanceNumber}
          value={draft.total_ends}
          max={DISTANCE_LIMITS.totalEnds}
          invalid={fieldErrors.totalEnds !== undefined}
          unfitId={unfitShown ? unfitId : undefined}
          onChange={(v) => setDraft((d) => ({ ...d, total_ends: v }))}
        />
      </FieldRow>
      {unfitShown && <ShotsUnfitMessage id={unfitId} />}
    </>
  );
}

export function DistanceFields({
  roundFormat,
  roundBowType,
  targetFaces,
  hasShots,
  ...row
}: RowProps & {
  targetFaces: TargetFaceOption[];
  roundFormat: string;
  roundBowType: string;
  hasShots: boolean;
}) {
  // 編集不可の的を押したときだけ、的の直下に理由を出す。
  const [targetFaceLockedPressed, setTargetFaceLockedPressed] = useState(false);
  return (
    <>
      <DistanceRow {...row} isField={roundFormat === "field"} />
      <CountsRow {...row} />
      <TargetFaceField
        distanceNumber={row.distanceNumber}
        targetFaces={targetFaces}
        selectedId={row.draft.target_face_id}
        roundFormat={roundFormat}
        roundBowType={roundBowType}
        onSelect={(id) => row.setDraft((d) => ({ ...d, target_face_id: id }))}
        locked={hasShots}
        showLockedMessage={targetFaceLockedPressed}
        onLockedPress={() => setTargetFaceLockedPressed(true)}
      />
    </>
  );
}

// Marked/Unmarkedの選択欄(共通のSelect)。値は選択肢の文字列で、真偽値との写しはここの1か所に置く。
function MarkedSelect({
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
    <Select
      label={t("distanceMarkedToggle")}
      options={[
        { value: "marked", label: t("distanceMarked") },
        { value: "unmarked", label: t("distanceUnmarked") },
      ]}
      value={isMarked ? "marked" : "unmarked"}
      onChange={(value) => onChange(value === "marked")}
      testId={`distance-config-marked-${distanceNumber}`}
    />
  );
}
