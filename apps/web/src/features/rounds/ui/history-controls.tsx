"use client";

import { useTranslations } from "next-intl";
import type { Ref } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isDefaultHistoryCondition } from "../domain/history-filter-draft";
import type { HistoryCondition } from "../domain/history-view-state";

// ヘッダーの操作。図柄と名前は開閉によらず一定で、開閉は`aria-expanded`と背景(開いている間は`bg-muted`、そのホバーはより濃い`bg-foreground/10`)で示す。印は適用済み条件だけから決める。
export function HistoryControls({
  condition,
  open,
  panelId,
  buttonRef,
  onToggle,
}: {
  condition: HistoryCondition;
  open: boolean;
  panelId: string;
  buttonRef: Ref<HTMLButtonElement>;
  onToggle: () => void;
}) {
  const t = useTranslations("rounds");
  return (
    <button
      type="button"
      ref={buttonRef}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
      data-testid="history-controls-toggle"
      className={cn(
        buttonVariants({ variant: "ghost" }),
        "relative size-8 px-0",
        open && "bg-muted hover:bg-foreground/10",
      )}
    >
      <span className="sr-only">{t("historyFilterTitle")}</span>
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
    </button>
  );
}
