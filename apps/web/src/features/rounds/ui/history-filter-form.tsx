"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import {
  DEFAULT_HISTORY_FILTER_DRAFT,
  type HistoryFilterDraft,
  historyFilterDraftOf,
  historyInputOfDraft,
  NO_HISTORY_FILTER_ERRORS,
} from "../domain/history-filter-draft";
import type { HistoryInput, HistoryUnit } from "../domain/history-view-state";
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
  const change: Change = (patch) => {
    // 表示単位を切り替えると、得点の範囲のエラーは消える(期間は単位によらず共通なので残る。下書きの文字は残す)。
    if (patch.unit !== undefined && patch.unit !== draft.unit) {
      setErrors((current) => ({
        range: current.range.filter((error) => !error.startsWith("score")),
      }));
    }
    setDraft((current) => ({ ...current, ...patch }));
  };

  function apply() {
    const result = historyInputOfDraft(draft, input);
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

// 表示単位の切り替え。選択肢と単位の値の写しは、ここ1か所に置く。
function UnitToggle({
  unit,
  onChange,
}: {
  unit: HistoryUnit;
  onChange: (unit: HistoryUnit) => void;
}) {
  const t = useTranslations("rounds");
  const options: { value: HistoryUnit; label: string }[] = [
    { value: "round", label: t("historyUnitRound") },
    { value: "distance", label: t("historyUnitDistance") },
  ];
  return (
    <SegmentedControl
      label={t("historyUnitLabel")}
      options={options}
      value={unit}
      onChange={(next) => {
        const found = options.find((option) => option.value === next);
        if (found) onChange(found.value);
      }}
      testId="history-unit"
    />
  );
}

// 先頭の行(スクロールしない)。右端に閉じるボタンを置き、表示単位の切り替えは、閉じるボタンを除いた領域の水平方向の中央に置く。
function FilterHeaderRow({
  unit,
  onUnitChange,
  onClose,
}: {
  unit: HistoryUnit;
  onUnitChange: (unit: HistoryUnit) => void;
  onClose: () => void;
}) {
  const t = useTranslations("rounds");
  return (
    <div className="flex shrink-0 items-center gap-2 p-3">
      <div className="flex min-w-0 flex-1 justify-center">
        <UnitToggle unit={unit} onChange={onUnitChange} />
      </div>
      <button
        type="button"
        onClick={onClose}
        data-testid="history-filter-close"
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "size-8 shrink-0 px-0",
        )}
      >
        <X aria-hidden="true" className="size-5" />
        <span className="sr-only">{t("historyFilterClose")}</span>
      </button>
    </div>
  );
}

// 下部の行(スクロールしない)。リセット・検索は、行の幅を半分ずつ占める(`min-w-0`は付けず、狭いときは文言の幅を優先する)。
function FilterActionRow() {
  const t = useTranslations("rounds");
  return (
    <div className="flex shrink-0 items-center gap-2 p-3">
      <button
        type="reset"
        data-testid="history-controls-reset"
        className={cn(buttonVariants({ variant: "outline" }), "flex-1")}
      >
        {t("historyControlsReset")}
      </button>
      <button
        type="submit"
        data-testid="history-controls-apply"
        className={cn(buttonVariants(), "flex-1")}
      >
        {t("historyControlsApply")}
      </button>
    </div>
  );
}

// 編集セッションごとの下書きと検証を持つ単一フォーム。input は現在の入力値で、開いたときの下書きの元であり、検索のたびに、使わない単位の値を引き継ぐ基準(base)にもなる(横長で検索後も開いたままのとき、更新された値が届く)。上から、表示単位の切り替えと閉じるボタンの行(スクロールしない)、入力欄(スクロールする)、リセット・検索の行(スクロールしない)。
export function HistoryFilterForm({
  input,
  onApply,
  onClose,
}: {
  input: HistoryInput;
  onApply: (input: HistoryInput) => void;
  onClose: () => void;
}) {
  const { draft, errors, change, apply, reset } = useFilterDraft(
    input,
    onApply,
  );

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
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
      <FilterHeaderRow
        unit={draft.unit}
        onUnitChange={(unit) => change({ unit })}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <HistoryRangeFields
          draft={draft}
          errors={errors.range}
          onChange={change}
        />
        <FormatAndBowType draft={draft} onChange={change} />
        {draft.unit === "distance" ? (
          <HistoryDistanceSelect
            row={draft.distanceRow}
            filter={draft}
            onChange={(distanceRow) => change({ distanceRow })}
          />
        ) : (
          <HistoryDistanceList
            rows={draft.distances}
            filter={draft}
            onChange={(distances) => change({ distances })}
          />
        )}
      </div>
      <FilterActionRow />
    </form>
  );
}
