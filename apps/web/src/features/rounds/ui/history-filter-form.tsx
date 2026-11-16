"use client";

import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_HISTORY_FILTER_DRAFT,
  type HistoryFilterDraft,
  historyFilterDraftOf,
  historyInputOfDraft,
  NO_HISTORY_FILTER_ERRORS,
} from "../domain/history-filter-draft";
import type { HistoryInput } from "../domain/history-view-state";
import {
  HistoryDistanceList,
  HistoryDistanceSelect,
} from "./history-distance-fields";
import { NullableSelect } from "./history-nullable-select";
import { HistoryRangeFields } from "./history-range-fields";
import { useOptionLabels } from "./use-option-labels";

type Change = (change: Partial<HistoryFilterDraft>) => void;

// 種別と弓種の選択。
function FormatAndBowType({
  draft,
  onChange,
}: {
  draft: HistoryFilterDraft;
  onChange: Change;
}) {
  const t = useTranslations("rounds");
  const { formatOptions, bowTypeOptions } = useOptionLabels();
  return (
    <div className="grid grid-cols-2 gap-2">
      <NullableSelect
        label={t("roundConfigFormat")}
        options={formatOptions}
        value={draft.format}
        onChange={(format) => onChange({ format })}
        testId="history-filter-format"
      />
      <NullableSelect
        label={t("roundConfigBowType")}
        options={bowTypeOptions}
        value={draft.bowType}
        onChange={(bowType) => onChange({ bowType })}
        testId="history-filter-bow-type"
      />
    </div>
  );
}

function useFilterDraft(
  input: HistoryInput,
  onApply: (input: HistoryInput) => void,
) {
  const [draft, setDraft] = useState(() => historyFilterDraftOf(input));
  const [errors, setErrors] = useState(NO_HISTORY_FILTER_ERRORS);
  const change: Change = (patch) =>
    setDraft((current) => ({ ...current, ...patch }));

  function apply() {
    const result = historyInputOfDraft(draft);
    if (result.ok) {
      setErrors(NO_HISTORY_FILTER_ERRORS);
      onApply(result.input);
    } else {
      setErrors(result.errors);
    }
  }

  const reset = () => {
    setDraft(DEFAULT_HISTORY_FILTER_DRAFT);
    setErrors(NO_HISTORY_FILTER_ERRORS);
  };
  return { draft, errors, change, apply, reset };
}

// 編集セッションごとの下書きと検証を持つ単一フォーム。
export function HistoryFilterForm({
  input,
  formId,
  onApply,
}: {
  input: HistoryInput;
  formId: string;
  onApply: (input: HistoryInput) => void;
}) {
  const t = useTranslations("rounds");
  const formRef = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    formRef.current?.querySelector("input")?.focus({ preventScroll: true });
  }, []);
  const { draft, errors, change, apply, reset } = useFilterDraft(
    input,
    onApply,
  );

  return (
    <form
      id={formId}
      ref={formRef}
      className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4"
      data-testid="history-controls"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
      onReset={(event) => {
        event.preventDefault();
        reset();
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLInputElement &&
          event.currentTarget.contains(event.target)
        )
          event.preventDefault();
      }}
    >
      <div className="flex flex-col gap-4">
        <HistoryRangeFields
          draft={draft}
          errors={errors.range}
          onChange={change}
        />
        <FormatAndBowType draft={draft} onChange={change} />
        <HistoryDistanceList
          rows={draft.distances}
          filter={draft}
          onChange={(distances) => change({ distances })}
        />
        <Switch
          label={t("historyShowDistances")}
          checked={draft.unit === "distance"}
          onChange={(on) => change({ unit: on ? "distance" : "round" })}
          testId="history-unit-toggle"
        />
        {draft.unit === "distance" && (
          <HistoryDistanceSelect
            row={draft.distanceRow}
            filter={draft}
            onChange={(distanceRow) => change({ distanceRow })}
          />
        )}
      </div>
    </form>
  );
}
