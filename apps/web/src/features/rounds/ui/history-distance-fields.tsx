"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  type HistoryCondition,
  type HistoryDistanceDraftRow,
  type HistoryDistanceError,
  type HistoryDistanceRow,
  historyDistancesOf,
} from "../domain/history-view-state";
import { lookupTargetFace, type TargetFaceOption } from "../domain/target-face";
import { FILTER_ALL, filterTargetFaces } from "../domain/target-face-filter";
import { useRoundProcedures } from "./rounds-context";
import { TargetFaceInfo } from "./target-face-info";
import { FilterTabs, TargetFaceList } from "./target-face-picker";
import { useOptionLabels } from "./use-option-labels";

type KeyedRow = { key: number; draft: HistoryDistanceDraftRow };
type RowError = { row: number; error: HistoryDistanceError };
type NumericField = "distance" | "arrowsPerEnd" | "totalArrows";
// 反映する値。距離の構成なら行の配列、距離単位の距離の行なら行(指定なしは null)。
type DistanceChange =
  | { distances: HistoryDistanceRow[] }
  | { distanceRow: HistoryDistanceRow | null };

const CONFIG_TEST_ID = "history-filter-distance";
const ROW_TEST_ID = "history-filter-distance-row";

const NUMERIC_FIELDS: { field: NumericField; error: HistoryDistanceError }[] = [
  { field: "distance", error: "distanceInvalid" },
  { field: "arrowsPerEnd", error: "arrowsPerEndInvalid" },
  { field: "totalArrows", error: "totalArrowsInvalid" },
];

const EMPTY_ROW: HistoryDistanceDraftRow = {
  distance: "",
  arrowsPerEnd: "",
  totalArrows: "",
  targetFaceId: null,
};

function textOf(value: number | null): string {
  return value === null ? "" : String(value);
}

function draftOf(row: HistoryDistanceRow): HistoryDistanceDraftRow {
  return {
    distance: String(row.distance),
    arrowsPerEnd: textOf(row.arrowsPerEnd),
    totalArrows: textOf(row.totalArrows),
    targetFaceId: row.targetFaceId,
  };
}

function isSameDistances(
  a: readonly HistoryDistanceRow[],
  b: readonly HistoryDistanceRow[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (row, i) =>
        row.distance === b[i].distance &&
        row.arrowsPerEnd === b[i].arrowsPerEnd &&
        row.totalArrows === b[i].totalArrows &&
        row.targetFaceId === b[i].targetFaceId,
    )
  );
}

// 的の選択の一覧。種別・弓種のタブの既定は、条件の種別・弓種(指定なしなら「すべて」)。
function TargetFaceChoice({
  testId,
  selectedId,
  targetFaces,
  condition,
  onSelect,
  children,
}: {
  testId: string;
  selectedId: string | null;
  targetFaces: TargetFaceOption[];
  condition: HistoryCondition;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  const t = useTranslations("rounds");
  const { formatOptions, bowTypeOptions } = useOptionLabels();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<string>(condition.format ?? FILTER_ALL);
  const [bowType, setBowType] = useState<string>(
    condition.bowType ?? FILTER_ALL,
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        data-testid={testId}
        className={
          selectedId === null
            ? buttonVariants({ variant: "outline", size: "sm" })
            : undefined
        }
      >
        {children}
      </DialogTrigger>
      <DialogContent className="flex h-[70vh] flex-col overflow-y-hidden">
        <div className="flex h-full flex-col gap-3">
          <FilterTabs
            options={[
              { value: FILTER_ALL, label: t("filterAll") },
              ...formatOptions,
            ]}
            current={format}
            testIdPrefix="target-face-format-tab"
            onChange={setFormat}
          />
          <FilterTabs
            options={[
              { value: FILTER_ALL, label: t("filterAll") },
              ...bowTypeOptions,
            ]}
            current={bowType}
            testIdPrefix="target-face-bow-type-tab"
            onChange={setBowType}
          />
          <TargetFaceList
            faces={filterTargetFaces(targetFaces, format, bowType)}
            selectedId={selectedId}
            onSelect={(id) => {
              onSelect(id);
              setOpen(false);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 的の指定。未指定なら「的を加える」、指定済みなら的の表示(押すと選び直し)と「的を外す」。
function TargetFaceSelection({
  prefix,
  targetFaceId,
  targetFaces,
  condition,
  onSelect,
}: {
  prefix: string;
  targetFaceId: string | null;
  targetFaces: TargetFaceOption[];
  condition: HistoryCondition;
  onSelect: (id: string | null) => void;
}) {
  const t = useTranslations("rounds");
  return (
    <>
      <TargetFaceChoice
        testId={targetFaceId === null ? `${prefix}-add` : prefix}
        selectedId={targetFaceId}
        targetFaces={targetFaces}
        condition={condition}
        onSelect={onSelect}
      >
        {targetFaceId === null ? (
          t("historyFilterTargetAdd")
        ) : (
          <TargetFaceInfo face={lookupTargetFace(targetFaces, targetFaceId)} />
        )}
      </TargetFaceChoice>
      {targetFaceId !== null && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`${prefix}-clear`}
          onClick={() => onSelect(null)}
        >
          {t("historyFilterTargetRemove")}
        </Button>
      )}
    </>
  );
}

function RowInput({
  testId,
  label,
  value,
  invalid,
  onChange,
  onCommit,
}: {
  testId: string;
  label: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={testId} className="text-muted-foreground text-xs">
        {label}
      </label>
      <Input
        id={testId}
        type="text"
        inputMode="numeric"
        data-testid={testId}
        value={value}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
        }}
      />
    </div>
  );
}

// 距離の構成の1行。3つの入力と、的の指定、行の削除、行ごとのエラー。
function DistanceRow({
  testIdBase,
  index,
  draft,
  errors,
  targetFaces,
  condition,
  onChange,
  onTarget,
  onCommit,
  onRemove,
}: {
  testIdBase: string;
  index: number;
  draft: HistoryDistanceDraftRow;
  errors: readonly HistoryDistanceError[];
  targetFaces: TargetFaceOption[];
  condition: HistoryCondition;
  onChange: (field: NumericField, value: string) => void;
  onTarget: (id: string | null) => void;
  onCommit: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("rounds");
  const prefix = `${testIdBase}-${index}`;
  const labels: Record<NumericField, string> = {
    distance: t("historyFilterDistance"),
    arrowsPerEnd: t("historyFilterArrowsPerEnd"),
    totalArrows: t("historyFilterTotalArrows"),
  };
  return (
    <div className="flex flex-col gap-2" data-testid={prefix}>
      <div className="flex gap-2">
        {NUMERIC_FIELDS.map(({ field, error }) => (
          <RowInput
            key={field}
            testId={`${prefix}-${field}`}
            label={labels[field]}
            value={draft[field]}
            invalid={errors.includes(error)}
            onChange={(value) => onChange(field, value)}
            onCommit={onCommit}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <TargetFaceSelection
          prefix={`${prefix}-target`}
          targetFaceId={draft.targetFaceId}
          targetFaces={targetFaces}
          condition={condition}
          onSelect={onTarget}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          data-testid={`${prefix}-remove`}
          onClick={onRemove}
        >
          {t("historyFilterDistanceRemove", { index: String(index + 1) })}
        </Button>
      </div>
      {errors.map((error) => (
        <p
          key={error}
          role="alert"
          className="text-destructive text-sm"
          data-testid={`${testIdBase}-error-${index}-${error}`}
        >
          {t(`historyDistanceError.${error}`)}
        </p>
      ))}
    </div>
  );
}

// 保存済みの的の一覧。表示の開始後に読み、無ければ空の一覧とする。
function useSavedTargetFaces(): TargetFaceOption[] {
  const { fetching } = useRoundProcedures();
  const [targetFaces, setTargetFaces] = useState<TargetFaceOption[]>([]);
  useEffect(() => {
    setTargetFaces(fetching.savedTargetFaces() ?? []);
  }, [fetching]);
  return targetFaces;
}

// 行の下書きと、まとめた検証・反映。反映するのは、全ての行が正しく、かつ現在の値と違うときだけである。
function useDistanceDrafts(
  current: readonly HistoryDistanceRow[],
  onApply: (distances: HistoryDistanceRow[]) => void,
) {
  const nextKey = useRef(current.length);
  const [rows, setRows] = useState<KeyedRow[]>(() =>
    current.map((row, key) => ({ key, draft: draftOf(row) })),
  );
  const [errors, setErrors] = useState<readonly RowError[]>([]);

  function commit(target: readonly KeyedRow[]) {
    const result = historyDistancesOf(target.map((row) => row.draft));
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    if (!isSameDistances(result.distances, current)) {
      onApply(result.distances);
    }
  }

  // 下書きを変える。反映するときは、その値でまとめて検証する。
  function change(next: KeyedRow[], applies: boolean) {
    setRows(next);
    if (applies) commit(next);
  }

  const update = (
    key: number,
    patch: Partial<HistoryDistanceDraftRow>,
    applies: boolean,
  ) =>
    change(
      rows.map((row) =>
        row.key === key ? { ...row, draft: { ...row.draft, ...patch } } : row,
      ),
      applies,
    );
  const add = () => {
    nextKey.current += 1;
    change([...rows, { key: nextKey.current, draft: EMPTY_ROW }], false);
  };
  const remove = (key: number) =>
    change(
      rows.filter((row) => row.key !== key),
      true,
    );
  return { rows, errors, commit: () => commit(rows), update, add, remove };
}

// 距離の入力。`single`でないときは距離の構成(行の数に上限なし)、`single`のときは距離単位の距離の行(行の上限は1)。数値の入力を離れたときかEnter、行の削除、的の選択・外すで反映し、行の追加では反映しない。不正なときは反映せず、行ごとにエラーを出して入力した文字を残す。
export function HistoryDistanceFields({
  condition,
  onApply,
  single = false,
}: {
  condition: HistoryCondition;
  onApply: (change: DistanceChange) => void;
  single?: boolean;
}) {
  const t = useTranslations("rounds");
  const targetFaces = useSavedTargetFaces();
  const { rows, errors, commit, update, add, remove } = useDistanceDrafts(
    single
      ? condition.distanceRow === null
        ? []
        : [condition.distanceRow]
      : condition.distances,
    (distances) =>
      onApply(single ? { distanceRow: distances[0] ?? null } : { distances }),
  );
  const testIdBase = single ? ROW_TEST_ID : CONFIG_TEST_ID;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground text-sm">
        {t(single ? "historyFilterDistanceRow" : "historyFilterDistances")}
      </span>
      {rows.map(({ key, draft }, index) => (
        <DistanceRow
          key={key}
          testIdBase={testIdBase}
          index={index}
          draft={draft}
          errors={errors.filter((e) => e.row === index).map((e) => e.error)}
          targetFaces={targetFaces}
          condition={condition}
          onChange={(field, value) => update(key, { [field]: value }, false)}
          onTarget={(id) => update(key, { targetFaceId: id }, true)}
          onCommit={commit}
          onRemove={() => remove(key)}
        />
      ))}
      {!(single && rows.length >= 1) && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          data-testid={`${testIdBase}-add`}
          onClick={add}
        >
          {t("historyFilterDistanceAdd")}
        </Button>
      )}
    </div>
  );
}
