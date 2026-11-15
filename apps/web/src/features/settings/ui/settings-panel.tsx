"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type MouseEvent, type ReactNode, useCallback, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SETTINGS_ACCOUNT_HASH } from "@/routes";
import type {
  SettingsItemView,
  SettingsView,
} from "../domain/settings-location";
import { SettingsAccount } from "./settings-account";

// 項目の画面へ渡す、パネルの操作。
// onBack: 分類「アカウント」へ戻る(履歴を1つ積む)。onBusyChange: 処理中かを知らせる。処理中は、閉じる操作、分類の切り替え、戻るを受け付けない。
export type SettingsItemControls = {
  onBack: () => void;
  onBusyChange: (busy: boolean) => void;
};

// 項目の画面を描く関数。入口が認証の部品を組み立てて渡す。
export type SettingsItemRenderer = (
  view: SettingsItemView,
  controls: SettingsItemControls,
) => ReactNode;

// 処理中の値。表示が変わると解く。
function useBusy(view: SettingsView | null) {
  const [busy, setBusy] = useState(false);
  const [busyView, setBusyView] = useState(view);
  if (busyView !== view) {
    setBusyView(view);
    setBusy(false);
  }
  return { busy, setBusy };
}

// 設定パネル。今の画面の上に重ねるモーダルのダイアログで、見出し、閉じる、分類の一覧と、表示の領域を描く。
// view: 開いている表示(閉じているときはnull)。onMove: パネルの中で移る。onClose: 閉じる。
// signOut: 分類「アカウント」のサインアウトの行。renderItem: 項目の画面。表示が変わると外す(入力と途中の経過は残らない)。
// 閉じた後のフォーカスはパネルが戻さない(戻し先はレフトパネルの要素で、入口がレフトパネルへ渡す)。
export function SettingsPanel({
  view,
  onMove,
  onClose,
  signOut,
  renderItem,
}: {
  view: SettingsView | null;
  onMove: (view: SettingsView) => void;
  onClose: () => void;
  signOut: ReactNode;
  renderItem: SettingsItemRenderer;
}) {
  const t = useTranslations("settings");
  const { busy, setBusy } = useBusy(view);
  const move = (next: SettingsView) => {
    if (!busy) onMove(next);
  };
  const close = () => {
    if (!busy) onClose();
  };
  // 項目の画面の戻るも、処理中は受け付けない。
  const onBack = useCallback(() => {
    if (!busy) onMove("account");
  }, [busy, onMove]);

  return (
    <Dialog
      open={view !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        finalFocus={false}
        className="flex flex-col gap-0 overflow-hidden p-0 max-md:inset-0 max-md:h-full max-md:max-h-none max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0 md:h-[85vh] md:max-w-3xl"
      >
        <div className="flex h-[45px] shrink-0 items-center gap-2 border-b px-1.5">
          <DialogTitle className="truncate p-1.5 font-normal leading-5">
            {t("title")}
          </DialogTitle>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label={t("close")}
            className="ml-auto flex shrink-0 items-center p-1.5 disabled:opacity-50"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 max-md:flex-col">
          {/* 幅768px以上は左の縦の列。幅768px未満は上の横並びのタブで、折り返さず、はみ出すと並びだけが横にスクロールする。 */}
          <nav className="flex shrink-0 gap-1 p-2 max-md:overflow-x-auto max-md:border-b md:w-48 md:flex-col md:border-r">
            <CategoryLink
              href={SETTINGS_ACCOUNT_HASH}
              current={view !== null}
              disabled={busy}
              onSelect={() => move("account")}
            >
              {t("accountTitle")}
            </CategoryLink>
          </nav>
          <div className="min-h-0 min-w-0 flex-1">
            {view === "account" && (
              <SettingsAccount onMove={move} signOut={signOut} />
            )}
            {view !== null && view !== "account" && (
              // 表示ごとにkeyを変えて作り直す。
              <div key={view} className="h-full">
                {renderItem(view, { onBack, onBusyChange: setBusy })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 分類の一覧の項目。選んでいる分類にaria-current="page"と現在の見た目を付ける。処理中は押下を受け付けない。
function CategoryLink({
  href,
  current,
  disabled,
  onSelect,
  children,
}: {
  href: string;
  current: boolean;
  disabled: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      aria-disabled={disabled || undefined}
      onClick={(event: MouseEvent) => {
        event.preventDefault();
        if (!disabled) onSelect();
      }}
      className={cn(
        // 各タブは分類の名称と内側の余白の幅で、伸ばさない(分類が1つでも横いっぱいに広がらない)。
        "shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm",
        current && "bg-muted font-medium",
        disabled && "opacity-50",
      )}
    >
      {children}
    </a>
  );
}
