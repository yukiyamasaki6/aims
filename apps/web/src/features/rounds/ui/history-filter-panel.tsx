"use client";

import { useTranslations } from "next-intl";
import { type KeyboardEvent, type ReactNode, useEffect } from "react";
import { cn } from "@/lib/utils";

// パネル内(Portalの子を除く)のEscで閉じる。子ダイアログが処理したEscは対象外。
function closeOnEscape(event: KeyboardEvent<HTMLElement>, onClose: () => void) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (!event.currentTarget.contains(event.target as Node)) return;
  event.preventDefault();
  event.stopPropagation();
  onClose();
}

// 終了通知が来ない場合も破棄し、動きを減らす設定では即時に片付ける。
function useFilterCollapse(open: boolean, onCollapsed: () => void) {
  useEffect(() => {
    if (open) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setTimeout(onCollapsed, motion.matches ? 0 : 200);
    return () => window.clearTimeout(timer);
  }, [open, onCollapsed]);
}

// 縦長は一覧の上(下端に枠・影)、横長は右の列(左の線だけ)。外枠が中身を切り取り、枠・影は外枠自身に付ける。
export function HistoryFilterPanel({
  open,
  panelId,
  onClose,
  onCollapsed,
  children,
}: {
  open: boolean;
  panelId: string;
  onClose: () => void;
  onCollapsed: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("rounds");
  useFilterCollapse(open, onCollapsed);
  return (
    <div
      className={cn(
        "relative z-10 grid max-h-1/2 min-h-0 shrink-0 grid-rows-[0fr] overflow-hidden bg-card transition-[grid-template-rows,width] duration-200 motion-reduce:transition-none landscape:order-2 landscape:h-full landscape:max-h-none landscape:w-0 landscape:grid-rows-[1fr]",
        open &&
          "grid-rows-[1fr] border-foreground/20 border-b-2 shadow-[0_4px_6px_-1px_rgb(0_0_0/0.1),0_2px_4px_-2px_rgb(0_0_0/0.1)] landscape:w-2/5 landscape:border-b-0 landscape:border-l landscape:shadow-none",
      )}
    >
      <section
        id={panelId}
        aria-label={t("historyFilterTitle")}
        aria-hidden={!open}
        inert={!open}
        onKeyDown={(event) => closeOnEscape(event, onClose)}
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      >
        {children}
      </section>
    </div>
  );
}
