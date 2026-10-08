"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { labelOf } from "../_shared/option-label";
import { BOW_TYPE_OPTIONS, FORMAT_OPTIONS } from "../_shared/round-constants";
import type { SyncOperation } from "../_shared/sync-events";
import {
  buildRoundUpdatedOperation,
  type RoundConfig,
  type RoundConfigErrors,
  validateRoundConfig,
} from "./round-config";

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden="true">
      *
    </span>
  );
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
      crypto.randomUUID(),
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
        <span className="truncate">
          {[
            initial.name,
            initial.roundDate,
            labelOf(FORMAT_OPTIONS, initial.format),
            labelOf(BOW_TYPE_OPTIONS, initial.bowType),
          ]
            .filter((part) => part !== "")
            .join(" / ")}
        </span>
        <ChevronRight className="size-4 shrink-0" />
      </button>

      <Dialog
        open={expanded}
        onOpenChange={(open) => {
          if (!open) setExpanded(false);
        }}
      >
        <DialogContent>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="round-config-name"
                className="text-muted-foreground text-xs"
              >
                ラウンド名
              </label>
              <Input
                id="round-config-name"
                data-testid="round-config-name"
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                aria-invalid={Boolean(fieldErrors.name)}
              />
              {fieldErrors.name && (
                <p className="text-destructive text-sm">{fieldErrors.name}</p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="round-config-date"
                className="text-muted-foreground text-xs"
              >
                実施日 <RequiredMark />
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
                  {fieldErrors.roundDate}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                種別 <RequiredMark />
              </span>
              <div className="grid grid-cols-3 gap-2">
                {FORMAT_OPTIONS.map((o) => (
                  <Button
                    key={o.value}
                    type="button"
                    variant={draft.format === o.value ? "default" : "outline"}
                    size="sm"
                    data-testid={`round-config-format-${o.value}`}
                    onClick={() => setDraft((d) => ({ ...d, format: o.value }))}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
              {fieldErrors.format && (
                <p className="text-destructive text-sm">{fieldErrors.format}</p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                弓種 <RequiredMark />
              </span>
              <div className="grid grid-cols-3 gap-2">
                {BOW_TYPE_OPTIONS.map((o) => (
                  <Button
                    key={o.value}
                    type="button"
                    variant={draft.bowType === o.value ? "default" : "outline"}
                    size="sm"
                    data-testid={`round-config-bow-type-${o.value}`}
                    onClick={() =>
                      setDraft((d) => ({ ...d, bowType: o.value }))
                    }
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
            </div>

            <Button
              type="button"
              className="w-full"
              data-testid="round-config-save"
              onClick={handleSave}
            >
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
