"use client";

import { type Dispatch, type SetStateAction, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SyncOperation } from "@/features/rounds/sync-events";
import type { TargetFaceOption } from "@/features/rounds/target-face-types";
import { cn } from "@/lib/utils";
import {
  buildDistanceDisabledOperation,
  buildDistanceUpdatedOperation,
  type DistanceConfig,
  type DistanceConfigErrors,
  type DistanceDraft,
  validateDistanceDraft,
} from "./distance-config";
import { TargetFacePicker } from "./target-face-picker";

const LOCKED_MESSAGE = "スコアが記録済みのため変更できません";

type LockedField = "arrows" | "total-ends" | "target-face";

// 編集不可の項目を押したときに、その項目の直下へ出す理由。
function LockedMessage({ id, testId }: { id: string; testId: string }) {
  return (
    <p
      id={id}
      role="alert"
      data-testid={testId}
      className="text-muted-foreground text-sm"
    >
      {LOCKED_MESSAGE}
    </p>
  );
}

const MARKED_OPTIONS = [
  { value: true, label: "Marked" },
  { value: false, label: "Unmarked" },
];

// distance-summary行のタップでポップアップ表示される、距離1件分の編集フォーム。
// 自身では開閉状態を持たず、ScorecardClient側の管理下でマウント/アンマウントされる
// （マウントのたびにdraftと起点が現在値から作られ、開いている間は`distance`の変化で書き換えない）。
export function DistanceEditFields({
  distance,
  hasShots,
  targetFaces,
  roundFormat,
  roundBowType,
  onSaved,
  onDeleted,
  onOpenChange,
  enqueue,
}: {
  distance: DistanceConfig;
  hasShots: boolean;
  targetFaces: TargetFaceOption[];
  roundFormat: string;
  roundBowType: string;
  onSaved: (updated: DistanceConfig) => void;
  onDeleted: () => void;
  onOpenChange: (open: boolean) => void;
  enqueue: (operation: SyncOperation) => void;
}) {
  const {
    draft,
    setDraft,
    fieldErrors,
    confirmOpen,
    setConfirmOpen,
    handleSave,
    handleDeleteClick,
    performDelete,
  } = useDistanceEdit({ distance, hasShots, onSaved, onDeleted, enqueue });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="flex flex-col gap-3">
          <DistanceFields
            distanceNumber={distance.distanceNumber}
            draft={draft}
            setDraft={setDraft}
            fieldErrors={fieldErrors}
            targetFaces={targetFaces}
            roundFormat={roundFormat}
            roundBowType={roundBowType}
            hasShots={hasShots}
          />

          <DistanceEditActions
            distanceNumber={distance.distanceNumber}
            onSave={handleSave}
            onDelete={handleDeleteClick}
          />
        </div>
      </DialogContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        description="この距離にはすでにスコアが記録されています。削除するとスコアも失われます。削除しますか？"
        onConfirm={performDelete}
        nested
      />
    </Dialog>
  );
}

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

// 距離1件分の編集フォームの状態と、保存、削除の処理。
function useDistanceEdit({
  distance,
  hasShots,
  onSaved,
  onDeleted,
  enqueue,
}: {
  distance: DistanceConfig;
  hasShots: boolean;
  onSaved: (updated: DistanceConfig) => void;
  onDeleted: () => void;
  enqueue: (operation: SyncOperation) => void;
}) {
  // 保存の差は、開いたときの値(起点)と比べる。開いている間に届いた他の端末の変更を、変えていない項目の古い値で戻さないため。
  const [origin] = useState(distance);
  const [draft, setDraft] = useState<DistanceDraft>(distance);
  const [fieldErrors, setFieldErrors] = useState<DistanceConfigErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleSave() {
    const validation = validateDistanceDraft(draft);
    if (validation.type === "invalid") {
      setFieldErrors(validation.errors);
      return;
    }
    setFieldErrors({});

    onSaved(validation.config);
    // 変えた項目が無ければ、操作を積まない。
    const operation = buildDistanceUpdatedOperation(
      origin,
      validation.config,
      crypto.randomUUID(),
    );
    if (operation) enqueue(operation);
  }

  function performDelete() {
    onDeleted();
    enqueue(buildDistanceDisabledOperation(distance.id, crypto.randomUUID()));
  }

  function handleDeleteClick() {
    if (hasShots) {
      setConfirmOpen(true);
      return;
    }
    performDelete();
  }

  return {
    draft,
    setDraft,
    fieldErrors,
    confirmOpen,
    setConfirmOpen,
    handleSave,
    handleDeleteClick,
    performDelete,
  };
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
  const messageId = `distance-config-target-face-locked-${distanceNumber}`;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">的</span>
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

function DistanceFields({
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
        label="距離（m）"
        slug="distance"
        distanceNumber={distanceNumber}
        value={draft.distance}
        error={fieldErrors.distance}
        onChange={(v) => setDraft((d) => ({ ...d, distance: v }))}
      />

      <NumberField
        label="エンドあたりの本数"
        slug="arrows"
        distanceNumber={distanceNumber}
        value={draft.arrowsPerEnd}
        error={fieldErrors.arrowsPerEnd}
        locked={hasShots}
        lockedMessage={pressedLocked === "arrows"}
        onLockedPress={() => setPressedLocked("arrows")}
        onChange={(v) => setDraft((d) => ({ ...d, arrowsPerEnd: v }))}
      />

      <NumberField
        label="総エンド数"
        slug="total-ends"
        distanceNumber={distanceNumber}
        value={draft.totalEnds}
        error={fieldErrors.totalEnds}
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

function DistanceEditActions({
  distanceNumber,
  onSave,
  onDelete,
}: {
  distanceNumber: number;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <Button
        type="button"
        className="w-full"
        data-testid={`distance-config-save-${distanceNumber}`}
        onClick={onSave}
      >
        保存
      </Button>

      <div className="flex flex-col gap-3 border-t pt-3">
        <Button
          type="button"
          variant="destructive"
          className="w-full"
          data-testid={`distance-config-delete-${distanceNumber}`}
          onClick={onDelete}
        >
          距離を削除
        </Button>
      </div>
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
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">Marked / Unmarked</span>
      <div className="grid grid-cols-2 gap-2">
        {MARKED_OPTIONS.map((o) => (
          <Button
            key={String(o.value)}
            type="button"
            variant={isMarked === o.value ? "default" : "outline"}
            size="sm"
            data-testid={`distance-config-${o.label.toLowerCase()}-${distanceNumber}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
