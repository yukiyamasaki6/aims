"use client";

import { useTranslations } from "next-intl";
import { Fragment, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { HistoryFilterDraft } from "../domain/history-filter-draft";
import {
  HISTORY_SORT_DIRECTIONS,
  type HistoryRangeDraft,
  type HistoryRangeError,
} from "../domain/history-view-state";
import { NullableSelect } from "./history-nullable-select";

// 範囲の2つの入力の間の記号。翻訳しない装飾である。
const RANGE_SEPARATOR = "~";

type FieldKey = keyof HistoryRangeDraft;
type FieldSpec = { field: FieldKey; label: string; numeric: boolean };
type Change = (change: Partial<HistoryFilterDraft>) => void;

function RangeInput({
  field,
  label,
  value,
  invalid,
  numeric,
  onChange,
}: FieldSpec & {
  value: string;
  invalid: boolean;
  onChange: (field: FieldKey, value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label
        htmlFor={`history-filter-${field}`}
        className="text-muted-foreground text-xs"
      >
        {label}
      </label>
      <Input
        id={`history-filter-${field}`}
        type={numeric ? "text" : "date"}
        inputMode={numeric ? "numeric" : undefined}
        data-testid={`history-filter-${field}`}
        value={value}
        aria-invalid={invalid}
        onChange={(e) => onChange(field, e.target.value)}
      />
    </div>
  );
}

// 日付順(必ず指定)。編集中の値を変えるだけで、適用で反映する。
function DateDirectionSelect({
  draft,
  onChange,
}: {
  draft: HistoryFilterDraft;
  onChange: Change;
}) {
  const t = useTranslations("rounds");
  return (
    <Select
      label={t("historyFilterDateDirection")}
      options={HISTORY_SORT_DIRECTIONS.map((value) => ({
        value,
        label: t(`historyDateDirection.${value}`),
      }))}
      value={draft.dateDirection}
      onChange={(next) => {
        const dateDirection = HISTORY_SORT_DIRECTIONS.find(
          (direction) => direction === next,
        );
        if (dateDirection) onChange({ dateDirection });
      }}
      testId="history-sort-date-direction"
      className="w-28"
    />
  );
}

// 得点順(指定なしがある)。編集中の値を変えるだけで、適用で反映する。
function ScoreDirectionSelect({
  draft,
  onChange,
}: {
  draft: HistoryFilterDraft;
  onChange: Change;
}) {
  const t = useTranslations("rounds");
  return (
    <NullableSelect
      label={t("historyFilterScoreDirection")}
      options={HISTORY_SORT_DIRECTIONS.map((value) => ({
        value,
        label: t(`historyScoreDirection.${value}`),
      }))}
      value={draft.scoreDirection}
      onChange={(scoreDirection) => onChange({ scoreDirection })}
      testId="history-sort-score-direction"
      className="w-28"
    />
  );
}

// 範囲の1行。2つの入力、向きの選択、エラー。
function RangeGroup({
  fields,
  errors,
  range,
  direction,
  onChange,
}: {
  fields: FieldSpec[];
  errors: readonly HistoryRangeError[];
  range: HistoryRangeDraft;
  direction: ReactNode;
  onChange: (field: FieldKey, value: string) => void;
}) {
  const t = useTranslations("rounds");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-48 flex-1 items-end gap-2">
          {fields.map((input, index) => (
            <Fragment key={input.field}>
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="pb-1.5 text-muted-foreground"
                >
                  {RANGE_SEPARATOR}
                </span>
              )}
              <RangeInput
                {...input}
                value={range[input.field]}
                invalid={errors.length > 0}
                onChange={onChange}
              />
            </Fragment>
          ))}
        </div>
        {direction}
      </div>
      {errors.map((error) => (
        <p
          key={error}
          role="alert"
          className="text-destructive text-sm"
          data-testid={`history-filter-error-${error}`}
        >
          {t(`historyRangeError.${error}`)}
        </p>
      ))}
    </div>
  );
}

// 期間と得点の範囲の入力と、それぞれの並べ替えの向き。値を持たず、編集中の値とエラーを受けて、変更を返すだけである。
export function HistoryRangeFields({
  draft,
  errors,
  onChange,
}: {
  draft: HistoryFilterDraft;
  errors: readonly HistoryRangeError[];
  onChange: Change;
}) {
  const t = useTranslations("rounds");
  const inputs: FieldSpec[] = [
    { field: "dateFrom", label: t("historyFilterDateFrom"), numeric: false },
    { field: "dateTo", label: t("historyFilterDateTo"), numeric: false },
    { field: "scoreMin", label: t("historyFilterScoreMin"), numeric: true },
    { field: "scoreMax", label: t("historyFilterScoreMax"), numeric: true },
  ];
  const setField = (field: FieldKey, value: string) =>
    onChange({ range: { ...draft.range, [field]: value } });
  return (
    <>
      <RangeGroup
        fields={inputs.slice(0, 2)}
        errors={errors.filter((e) => e.startsWith("date"))}
        range={draft.range}
        onChange={setField}
        direction={<DateDirectionSelect draft={draft} onChange={onChange} />}
      />
      <RangeGroup
        fields={inputs.slice(2)}
        errors={errors.filter((e) => e.startsWith("score"))}
        range={draft.range}
        onChange={setField}
        direction={<ScoreDirectionSelect draft={draft} onChange={onChange} />}
      />
    </>
  );
}
