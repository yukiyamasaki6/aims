"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { updateRoundConfig } from "./actions";

export const FORMAT_OPTIONS = [
  { value: "outdoor", label: "アウトドア" },
  { value: "indoor", label: "インドア" },
  { value: "field", label: "フィールド" },
];

export const BOW_TYPE_OPTIONS = [
  { value: "recurve", label: "リカーブ" },
  { value: "compound", label: "コンパウンド" },
  { value: "barebow", label: "ベアボウ" },
];

export function labelOf(
  options: { value: string; label: string }[],
  value: string,
) {
  return options.find((o) => o.value === value)?.label ?? value;
}

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
}: {
  roundId: string;
  initial: RoundConfig;
  onSaved: (updated: RoundConfig) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleExpanded() {
    if (!expanded) {
      // 展開のたびに、直前の保存値を編集の起点にする（未保存の変更は破棄する）。
      setDraft(saved);
      setError(null);
    }
    setExpanded((v) => !v);
  }

  async function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const result = await updateRoundConfig({ roundId, ...draft });
    if (result?.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    setSaved(draft);
    onSaved(draft);
    setSubmitting(false);
    setExpanded(false);
  }

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <button
        type="button"
        data-testid="round-config-summary"
        onClick={toggleExpanded}
        className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm"
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
              />
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
              />
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

            {error && <p className="text-destructive text-sm">{error}</p>}

            <Button
              type="button"
              className="w-full"
              disabled={submitting}
              data-testid="round-config-save"
              onClick={handleSave}
            >
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
