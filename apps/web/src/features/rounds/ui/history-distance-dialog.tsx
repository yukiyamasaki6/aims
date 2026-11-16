"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  type HistoryDistanceDraftRow,
  type HistoryDistanceError,
  type HistoryDistanceRow,
  historyDistanceDraftRowOf,
  historyDistancesOf,
} from "../domain/history-view-state";
import {
  TargetFaceSelection,
  type TargetFilter,
  useSavedTargetFaces,
} from "./history-target-selection";

// ダイアログの用途。追加(ラウンド構成)は「追加」、選択(距離単位)は「決定」、編集は「保存」と「削除」で確定する。
export type HistoryDistanceDialogMode = "add" | "select" | "edit";

const TEST_ID = "history-distance-dialog";

const EMPTY_DRAFT: HistoryDistanceDraftRow = {
  distance: "",
  arrowsPerEnd: "",
  targetFaceId: null,
};

function NumberField({
  field,
  label,
  value,
  error,
  onChange,
}: {
  field: "distance" | "arrowsPerEnd";
  label: string;
  value: string;
  error: HistoryDistanceError | null;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("rounds");
  const testId = `${TEST_ID}-${field}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={testId} className="text-muted-foreground text-xs">
        {label}
      </label>
      <Input
        id={testId}
        type="text"
        inputMode="numeric"
        data-testid={testId}
        value={value}
        aria-invalid={error !== null}
        onChange={(e) => onChange(e.target.value)}
      />
      {error !== null && (
        <p
          role="alert"
          className="text-destructive text-sm"
          data-testid={`${TEST_ID}-error-${error}`}
        >
          {t(`historyDistanceError.${error}`)}
        </p>
      )}
    </div>
  );
}

// 確定のボタン。編集のときは、その左に「削除」を置く(確認はない。距離単位では指定を外す操作)。
function DistanceActions({
  mode,
  onConfirm,
  onDelete,
}: {
  mode: HistoryDistanceDialogMode;
  onConfirm: () => void;
  onDelete?: () => void;
}) {
  const t = useTranslations("rounds");
  const confirmLabel = {
    add: t("historyDistanceAdd"),
    select: t("historyDistanceDecide"),
    edit: t("confirm"),
  }[mode];
  return (
    <div className="flex gap-2">
      {onDelete && (
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          data-testid={`${TEST_ID}-delete`}
          onClick={onDelete}
        >
          {t("delete")}
        </Button>
      )}
      <Button
        type="button"
        className="flex-1"
        data-testid={`${TEST_ID}-confirm`}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}

// 距離のダイアログの中身。開くたびに作り直し、入力の文字と的は自身が持つ。確定のボタンで検証し、正しければ確定して閉じ、不正なら閉じずに欄の下にエラーを出す(次に押すまで更新しない)。
function DistanceForm({
  mode,
  row,
  filter,
  onConfirm,
  onDelete,
  onClose,
}: {
  mode: HistoryDistanceDialogMode;
  row: HistoryDistanceRow | null;
  filter: TargetFilter;
  onConfirm: (row: HistoryDistanceRow) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("rounds");
  const targetFaces = useSavedTargetFaces();
  const [draft, setDraft] = useState<HistoryDistanceDraftRow>(
    row === null ? EMPTY_DRAFT : historyDistanceDraftRowOf(row),
  );
  const [errors, setErrors] = useState<HistoryDistanceError[]>([]);
  const errorOf = (error: HistoryDistanceError) =>
    errors.includes(error) ? error : null;

  function confirm() {
    const result = historyDistancesOf([draft]);
    if (result.ok) {
      onConfirm(result.distances[0]);
      onClose();
    } else {
      setErrors(result.errors.map((e) => e.error));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <NumberField
        field="distance"
        label={t("historyFilterDistance")}
        value={draft.distance}
        error={errorOf("distanceInvalid")}
        onChange={(distance) => setDraft({ ...draft, distance })}
      />
      <NumberField
        field="arrowsPerEnd"
        label={t("historyFilterArrowsPerEnd")}
        value={draft.arrowsPerEnd}
        error={errorOf("arrowsPerEndInvalid")}
        onChange={(arrowsPerEnd) => setDraft({ ...draft, arrowsPerEnd })}
      />
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`${TEST_ID}-target`}
          className="text-muted-foreground text-xs"
        >
          {t("historyFilterTarget")}
        </label>
        <TargetFaceSelection
          testId={`${TEST_ID}-target`}
          targetFaceId={draft.targetFaceId}
          targetFaces={targetFaces}
          filter={filter}
          onSelect={(targetFaceId) => setDraft({ ...draft, targetFaceId })}
        />
      </div>
      <DistanceActions
        mode={mode}
        onConfirm={confirm}
        onDelete={
          onDelete &&
          (() => {
            onDelete();
            onClose();
          })
        }
      />
    </div>
  );
}

// 距離のダイアログ。トリガー(追加・選択のボタン、または距離の要約)を押すと、入れ子の`Dialog`で距離・1エンドの矢数・的を入力する。Esc・外側のタップで閉じると入力は破棄され、呼び出し側の値は変わらない。
export function HistoryDistanceDialog({
  mode,
  row,
  filter,
  trigger,
  triggerTestId,
  triggerClassName,
  onConfirm,
  onDelete,
  deletedFocus,
}: {
  mode: HistoryDistanceDialogMode;
  row: HistoryDistanceRow | null;
  filter: TargetFilter;
  trigger: ReactNode;
  triggerTestId: string;
  triggerClassName: string;
  onConfirm: (row: HistoryDistanceRow) => void;
  // 編集のときだけ渡す(追加・選択には削除がない)。
  onDelete?: () => void;
  deletedFocus?: () => HTMLElement | null;
}) {
  const t = useTranslations("rounds");
  const [open, setOpen] = useState(false);
  const deleted = useRef(false);
  const title = {
    add: t("addDistance"),
    select: t("historyFilterDistanceSelect"),
    edit: t("historyDistanceEdit"),
  }[mode];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) deleted.current = false;
        setOpen(next);
      }}
    >
      <DialogTrigger data-testid={triggerTestId} className={triggerClassName}>
        {trigger}
      </DialogTrigger>
      <DialogContent
        nested
        finalFocus={() => (deleted.current ? (deletedFocus?.() ?? true) : true)}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DistanceForm
          mode={mode}
          row={row}
          filter={filter}
          onConfirm={onConfirm}
          onDelete={
            onDelete &&
            (() => {
              deleted.current = true;
              onDelete();
            })
          }
          onClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
