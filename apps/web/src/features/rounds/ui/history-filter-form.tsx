"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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

// フィルターのポップアップの中身。入力欄の領域だけがスクロールし、リセットと適用は下部に固定して表示する。開くたびに入力値から編集中の値を作り、閉じると破棄する。「適用」で検証し、正しければ新しい入力値を渡す。不正なときは入力値を変えず、エラーを次の適用まで残す。
export function HistoryFilterForm({
  input,
  onApply,
}: {
  input: HistoryInput;
  onApply: (input: HistoryInput) => void;
}) {
  const t = useTranslations("rounds");
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

  return (
    <div className="flex min-h-0 flex-col gap-4" data-testid="history-controls">
      <div className="-mx-1 flex min-h-0 flex-col gap-4 overflow-y-auto px-1 pb-1">
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
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          data-testid="history-controls-reset"
          onClick={() => {
            setDraft(DEFAULT_HISTORY_FILTER_DRAFT);
            setErrors(NO_HISTORY_FILTER_ERRORS);
          }}
        >
          {t("historyControlsReset")}
        </Button>
        <Button
          type="button"
          className="flex-1"
          data-testid="history-controls-apply"
          onClick={apply}
        >
          {t("historyControlsApply")}
        </Button>
      </div>
    </div>
  );
}
