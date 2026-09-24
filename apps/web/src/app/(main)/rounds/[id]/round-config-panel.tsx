"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { labelOf } from "../_shared/option-label";
import {
  BOW_TYPE_OPTIONS,
  FORMAT_OPTIONS,
  NAME_MAX_LENGTH,
} from "../_shared/round-constants";
import type { EnqueueInput } from "./use-sync-queue";

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden="true">
      *
    </span>
  );
}

export type RoundConfig = {
  name: string;
  roundDate: string;
  format: string;
  bowType: string;
};

export function RoundConfigPanel({
  roundId,
  initial,
  onSaved,
  defaultExpanded = false,
  hasUnmarkedDistances,
  enqueue,
}: {
  roundId: string;
  initial: RoundConfig;
  onSaved: (updated: RoundConfig) => void;
  defaultExpanded?: boolean;
  hasUnmarkedDistances: boolean;
  enqueue: (input: EnqueueInput) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    roundDate?: string;
    format?: string;
  }>({});

  useEffect(() => {
    setSaved(initial);
    setDraft(initial);
  }, [initial]);

  function toggleExpanded() {
    if (!expanded) {
      // 展開のたびに、直前の保存値を編集の起点にする（未保存の変更は破棄する）。
      setDraft(saved);
      setFieldErrors({});
    }
    setExpanded((v) => !v);
  }

  function handleSave() {
    // クライアントが既に持っている値（distancesのis_marked）だけで判定
    // できるため、サーバーへ投げる前に同期的に検証する
    // （キュー経由の非同期エラーにはしない）。
    const errors: typeof fieldErrors = {};
    if (draft.name.length > NAME_MAX_LENGTH) {
      errors.name = `ラウンド名は${NAME_MAX_LENGTH}文字以内で入力してください。`;
    }
    if (draft.roundDate === "") {
      errors.roundDate = "実施日を入力してください。";
    }
    if (draft.format !== "field" && hasUnmarkedDistances) {
      errors.format =
        "Unmarkedの距離が残っているため、フィールド以外の種別には変更できません。先に各距離をMarkedに変更してください。";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setSaved(draft);
    onSaved(draft);
    setExpanded(false);
    const roundEventId = crypto.randomUUID();
    enqueue({
      key: "roundConfig",
      label: "ラウンド設定",
      operation: {
        type: "round.updated",
        eventId: roundEventId,
        roundId,
        name: draft.name,
        roundDate: draft.roundDate,
        format: draft.format,
        bowType: draft.bowType,
      },
    });
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
            saved.name,
            saved.roundDate,
            labelOf(FORMAT_OPTIONS, saved.format),
            labelOf(BOW_TYPE_OPTIONS, saved.bowType),
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
