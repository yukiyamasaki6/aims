"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  type HistoryCondition,
  type HistoryRange,
  type HistoryRangeDraft,
  type HistoryRangeError,
  historyRangeOf,
} from "../domain/history-view-state";

function draftOf(range: HistoryRange): HistoryRangeDraft {
  return {
    dateFrom: range.dateFrom ?? "",
    dateTo: range.dateTo ?? "",
    scoreMin: range.scoreMin === null ? "" : String(range.scoreMin),
    scoreMax: range.scoreMax === null ? "" : String(range.scoreMax),
  };
}

function isSameRange(a: HistoryRange, b: HistoryRange): boolean {
  return (
    a.dateFrom === b.dateFrom &&
    a.dateTo === b.dateTo &&
    a.scoreMin === b.scoreMin &&
    a.scoreMax === b.scoreMax
  );
}

type FieldKey = keyof HistoryRangeDraft;

function RangeInput({
  field,
  label,
  draft,
  invalid,
  numeric,
  onChange,
  onCommit,
}: {
  field: FieldKey;
  label: string;
  draft: HistoryRangeDraft;
  invalid: boolean;
  numeric: boolean;
  onChange: (field: FieldKey, value: string) => void;
  onCommit: () => void;
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
        value={draft[field]}
        aria-invalid={invalid}
        onChange={(e) => onChange(field, e.target.value)}
        onBlur={onCommit}
      />
    </div>
  );
}

// 期間と得点の範囲の入力。4つの下書きを持ち、欄を離れたときかEnterで、まとめて検証して反映する。不正なときは反映せず、エラーを出して入力した文字を残す。
export function HistoryRangeFields({
  condition,
  onApply,
}: {
  condition: HistoryCondition;
  onApply: (range: HistoryRange) => void;
}) {
  const t = useTranslations("rounds");
  const [draft, setDraft] = useState(() => draftOf(condition));
  const [errors, setErrors] = useState<readonly HistoryRangeError[]>([]);

  function commit() {
    const result = historyRangeOf(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    if (!isSameRange(result.range, condition)) onApply(result.range);
  }

  const inputs: { field: FieldKey; label: string; numeric: boolean }[] = [
    { field: "dateFrom", label: t("historyFilterDateFrom"), numeric: false },
    { field: "dateTo", label: t("historyFilterDateTo"), numeric: false },
    { field: "scoreMin", label: t("historyFilterScoreMin"), numeric: true },
    { field: "scoreMax", label: t("historyFilterScoreMax"), numeric: true },
  ];
  const groups = [
    {
      label: t("historyFilterPeriod"),
      fields: inputs.slice(0, 2),
      errors: errors.filter((e) => e.startsWith("date")),
    },
    {
      label: t("historyFilterScore"),
      fields: inputs.slice(2),
      errors: errors.filter((e) => e.startsWith("score")),
    },
  ];

  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <span className="text-muted-foreground text-sm">{group.label}</span>
          <div className="flex gap-2">
            {group.fields.map(({ field, label, numeric }) => (
              <RangeInput
                key={field}
                field={field}
                label={label}
                draft={draft}
                invalid={group.errors.length > 0}
                numeric={numeric}
                onChange={(key, value) =>
                  setDraft((current) => ({ ...current, [key]: value }))
                }
                onCommit={commit}
              />
            ))}
          </div>
          {group.errors.map((error) => (
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
      ))}
    </>
  );
}
