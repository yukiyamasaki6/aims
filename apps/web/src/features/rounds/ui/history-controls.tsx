"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { isDefaultHistoryCondition } from "../domain/history-filter-draft";
import type {
  HistoryCondition,
  HistoryInput,
} from "../domain/history-view-state";
import { HistoryFilterForm } from "./history-filter-form";

// 履歴のヘッダーの右端のフィルター(置き場は画面が持つ)。アイコンのボタンと、導出されるフィルターが既定でないときの印(点)、既存のDialogのポップアップ(名前と中身。閉じるのはEsc、外側のタップ、適用)を描く。開閉は保持しない。
export function HistoryControls({
  input,
  condition,
  onApply,
}: {
  input: HistoryInput;
  condition: HistoryCondition;
  onApply: (input: HistoryInput) => void;
}) {
  const t = useTranslations("rounds");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={t("historyFilterTitle")}
        data-testid="history-controls-toggle"
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "relative size-8 px-0",
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 5h18l-7 8v6l-4 2v-8z" />
        </svg>
        {!isDefaultHistoryCondition(condition) && (
          <span
            className="absolute top-1 right-1 size-2.5 rounded-full bg-primary ring-2 ring-card"
            data-testid="history-controls-active"
          >
            <span className="sr-only">{t("historyFilterActive")}</span>
          </span>
        )}
      </DialogTrigger>
      <DialogContent className="flex flex-col gap-4 overflow-y-hidden">
        <DialogTitle className="sr-only">{t("historyFilterTitle")}</DialogTitle>
        <HistoryFilterForm
          input={input}
          onApply={(next) => {
            onApply(next);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
