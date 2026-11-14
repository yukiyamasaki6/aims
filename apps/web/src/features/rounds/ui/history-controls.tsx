import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  HISTORY_SORT_DIRECTIONS,
  HISTORY_SORT_KEYS,
  HISTORY_UNITS,
  type HistoryCondition,
  type HistoryViewState,
} from "../domain/history-view-state";
import { HistoryDistanceFields } from "./history-distance-fields";
import { HistoryRangeFields } from "./history-range-fields";
import type { HistoryViewControls } from "./use-history-view";
import { useOptionLabels } from "./use-option-labels";

type Option<T extends string> = { value: T; label: string };

const FILTER_ALL = "all";

// 見出し付きの操作の区画。
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 font-medium text-sm">{label}</legend>
      {children}
    </fieldset>
  );
}

// 単一選択の選択肢の並び。選択中の値を強調する。
function OptionGroup<T extends string>({
  label,
  options,
  current,
  testIdPrefix,
  onChange,
}: {
  label?: string;
  options: readonly Option<T>[];
  current: T;
  testIdPrefix: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {label && <span className="text-muted-foreground text-sm">{label}</span>}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={current === option.value ? "default" : "outline"}
            aria-pressed={current === option.value}
            data-testid={`${testIdPrefix}-${option.value}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

// 絞り込みの単一選択。null は「すべて」(絞り込みなし)。
function FilterGroup<T extends string>({
  label,
  options,
  current,
  testIdPrefix,
  onChange,
}: {
  label: string;
  options: readonly Option<T>[];
  current: T | null;
  testIdPrefix: string;
  onChange: (value: T | null) => void;
}) {
  const t = useTranslations("rounds");
  return (
    <OptionGroup<T | typeof FILTER_ALL>
      label={label}
      options={[{ value: FILTER_ALL, label: t("filterAll") }, ...options]}
      current={current ?? FILTER_ALL}
      testIdPrefix={testIdPrefix}
      onChange={(value) => onChange(value === FILTER_ALL ? null : value)}
    />
  );
}

// 絞り込みの区画。種別、弓種、期間、得点の範囲、距離単位の距離の行(単位が距離のときだけ)、距離の構成。
function HistoryFilters({
  condition,
  changeCondition,
  resetCount,
}: {
  condition: HistoryCondition;
  changeCondition: HistoryViewControls["changeCondition"];
  resetCount: number;
}) {
  const t = useTranslations("rounds");
  const { formatOptions, bowTypeOptions } = useOptionLabels();
  return (
    <Section label={t("historyControlsFilter")}>
      <FilterGroup
        label={t("roundConfigFormat")}
        options={formatOptions}
        current={condition.format}
        testIdPrefix="history-filter-format"
        onChange={(format) => changeCondition({ format })}
      />
      <FilterGroup
        label={t("roundConfigBowType")}
        options={bowTypeOptions}
        current={condition.bowType}
        testIdPrefix="history-filter-bow-type"
        onChange={(bowType) => changeCondition({ bowType })}
      />
      <HistoryRangeFields
        key={`range-${resetCount}`}
        condition={condition}
        onApply={changeCondition}
      />
      {condition.unit === "distance" && (
        <HistoryDistanceFields
          key={`distance-row-${resetCount}`}
          condition={condition}
          onApply={changeCondition}
          single
        />
      )}
      <HistoryDistanceFields
        key={`distance-${resetCount}`}
        condition={condition}
        onApply={changeCondition}
      />
    </Section>
  );
}

// 単位の切替と並べ替えの区画。
function HistoryOrdering({
  condition,
  changeCondition,
}: {
  condition: HistoryCondition;
  changeCondition: HistoryViewControls["changeCondition"];
}) {
  const t = useTranslations("rounds");
  return (
    <>
      <Section label={t("historyControlsUnit")}>
        <OptionGroup
          options={HISTORY_UNITS.map((value) => ({
            value,
            label: t(`historyUnit.${value}`),
          }))}
          current={condition.unit}
          testIdPrefix="history-unit"
          onChange={(unit) => changeCondition({ unit })}
        />
      </Section>
      <Section label={t("historyControlsSort")}>
        <OptionGroup
          options={HISTORY_SORT_KEYS.map((value) => ({
            value,
            label: t(`historySortKey.${value}`),
          }))}
          current={condition.sortKey}
          testIdPrefix="history-sort-key"
          onChange={(sortKey) => changeCondition({ sortKey })}
        />
        <OptionGroup
          options={HISTORY_SORT_DIRECTIONS.map((value) => ({
            value,
            label: t(`historySortDirection.${value}`),
          }))}
          current={condition.sortDirection}
          testIdPrefix="history-sort-direction"
          onChange={(sortDirection) => changeCondition({ sortDirection })}
        />
      </Section>
    </>
  );
}

// 履歴の上端の操作。開閉の取っ手と、開いているときの並べ替え、絞り込み、リセット。閉じている間は、選んだ値もリセットも示さない。
export function HistoryControls({
  state,
  controls,
}: {
  state: HistoryViewState;
  controls: Omit<HistoryViewControls, "state">;
}) {
  const t = useTranslations("rounds");
  const { condition, filterOpen } = state;
  const { changeCondition, resetCondition, toggleFilterOpen } = controls;
  // リセットで期間・得点・距離の構成の下書きとエラーを捨てるため、欄を作り直す。
  const [resetCount, setResetCount] = useState(0);
  return (
    <section className="flex flex-col gap-4">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        aria-expanded={filterOpen}
        data-testid="history-controls-toggle"
        onClick={toggleFilterOpen}
      >
        {t("historyControlsToggle")}
      </Button>
      {filterOpen && (
        <div className="flex flex-col gap-4" data-testid="history-controls">
          <HistoryOrdering
            condition={condition}
            changeCondition={changeCondition}
          />
          <HistoryFilters
            condition={condition}
            changeCondition={changeCondition}
            resetCount={resetCount}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            data-testid="history-controls-reset"
            onClick={() => {
              setResetCount((count) => count + 1);
              resetCondition();
            }}
          >
            {t("historyControlsReset")}
          </Button>
        </div>
      )}
    </section>
  );
}
