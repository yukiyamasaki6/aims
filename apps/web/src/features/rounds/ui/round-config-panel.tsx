"use client";

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { type Dispatch, type SetStateAction, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  buildRoundUpdatedOperation,
  type RoundConfig,
  type RoundConfigErrors,
  validateRoundConfig,
} from "../domain/round-config";
import type { SyncOperation } from "../domain/sync-events";
import { useRoundProcedures } from "./rounds-context";
import { useOptionLabels } from "./use-option-labels";

function RequiredMark() {
  const t = useTranslations("rounds");
  return (
    <span className="text-destructive" aria-hidden="true">
      {t("requiredMark")}
    </span>
  );
}

// 設定の要約行の文字列。名前、実施日、種別、弓種のうち、空でないものを並べる。
function useSummaryText(config: RoundConfig): string {
  const { formatLabel, bowTypeLabel } = useOptionLabels();
  return [
    config.name,
    config.roundDate,
    formatLabel(config.format),
    bowTypeLabel(config.bowType),
  ]
    .filter((part) => part !== "")
    .join(" / ");
}

export function RoundConfigPanel({
  roundId,
  initial,
  defaultExpanded = false,
  hasUnmarkedDistances,
  enqueue,
}: {
  roundId: string;
  initial: RoundConfig;
  defaultExpanded?: boolean;
  hasUnmarkedDistances: boolean;
  enqueue: (operation: SyncOperation) => void;
}) {
  const { ids } = useRoundProcedures();
  const summary = useSummaryText(initial);
  const [expanded, setExpanded] = useState(defaultExpanded);
  // 下書きと起点(開いたときの値)は、開いたときに作り、閉じるまで`initial`の変化で書き換えない。
  const [origin, setOrigin] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<RoundConfigErrors>({});

  function toggleExpanded() {
    if (!expanded) {
      setOrigin(initial);
      setDraft(initial);
      setFieldErrors({});
    }
    setExpanded((v) => !v);
  }

  function handleSave() {
    const validation = validateRoundConfig(draft, hasUnmarkedDistances);
    if (validation.type === "invalid") {
      setFieldErrors(validation.errors);
      return;
    }
    setFieldErrors({});

    const { config } = validation;
    const operation = buildRoundUpdatedOperation(
      roundId,
      origin,
      config,
      ids.next(),
    );
    setExpanded(false);
    // 変えた項目が無ければ、操作を積まない。
    if (operation) enqueue(operation);
  }

  return (
    <>
      <button
        type="button"
        data-testid="round-config-summary"
        onClick={toggleExpanded}
        className="flex w-full items-center justify-between gap-2 rounded-t-xl p-3 text-left text-sm"
      >
        <span className="truncate">{summary}</span>
        <ChevronRight className="size-4 shrink-0" />
      </button>

      <Dialog
        open={expanded}
        onOpenChange={(open) => {
          if (!open) setExpanded(false);
        }}
      >
        <DialogContent>
          <RoundConfigFields
            draft={draft}
            setDraft={setDraft}
            fieldErrors={fieldErrors}
            onSave={handleSave}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function RoundConfigFields({
  draft,
  setDraft,
  fieldErrors,
  onSave,
}: {
  draft: RoundConfig;
  setDraft: Dispatch<SetStateAction<RoundConfig>>;
  fieldErrors: RoundConfigErrors;
  onSave: () => void;
}) {
  const t = useTranslations("rounds");
  const { formatOptions, bowTypeOptions } = useOptionLabels();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="round-config-name"
          className="text-muted-foreground text-xs"
        >
          {t("roundConfigName")}
        </label>
        <Input
          id="round-config-name"
          data-testid="round-config-name"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          aria-invalid={Boolean(fieldErrors.name)}
        />
        {fieldErrors.name && (
          <p className="text-destructive text-sm">
            {t(`roundConfigError.${fieldErrors.name}`)}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="round-config-date"
          className="text-muted-foreground text-xs"
        >
          {t("roundConfigDate")} <RequiredMark />
        </label>
        <Input
          id="round-config-date"
          type="date"
          data-testid="round-config-date"
          value={draft.roundDate}
          onChange={(e) =>
            setDraft((d) => ({ ...d, roundDate: e.target.value }))
          }
          aria-invalid={Boolean(fieldErrors.roundDate)}
        />
        {fieldErrors.roundDate && (
          <p className="text-destructive text-sm">
            {t(`roundConfigError.${fieldErrors.roundDate}`)}
          </p>
        )}
      </div>

      <OptionGrid
        label={t("roundConfigFormat")}
        options={formatOptions}
        current={draft.format}
        testIdPrefix="round-config-format"
        error={
          fieldErrors.format && t(`roundConfigError.${fieldErrors.format}`)
        }
        onChange={(format) => setDraft((d) => ({ ...d, format }))}
      />

      <OptionGrid
        label={t("roundConfigBowType")}
        options={bowTypeOptions}
        current={draft.bowType}
        testIdPrefix="round-config-bow-type"
        onChange={(bowType) => setDraft((d) => ({ ...d, bowType }))}
      />

      <Button
        type="button"
        className="w-full"
        data-testid="round-config-save"
        onClick={onSave}
      >
        {t("save")}
      </Button>
    </div>
  );
}

// 必須の選択肢の組。
function OptionGrid({
  label,
  options,
  current,
  testIdPrefix,
  error,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  current: string;
  testIdPrefix: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">
        {label} <RequiredMark />
      </span>
      <div className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <Button
            key={o.value}
            type="button"
            variant={current === o.value ? "default" : "outline"}
            size="sm"
            data-testid={`${testIdPrefix}-${o.value}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
