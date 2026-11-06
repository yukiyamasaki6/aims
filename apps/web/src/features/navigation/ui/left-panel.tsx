"use client";

import { ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { LogoImage } from "@/components/logo-image";
import { cn } from "@/lib/utils";
import { HOME_PATH, ROUNDS_PATH } from "@/routes";

// 画面の幅768px未満のドロワーと、768px以上の縦の列は別の枠で、それぞれの開閉を持つ。初期値は固定で、幅で分岐しない。
function useOpenState() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  return { drawerOpen, setDrawerOpen, railOpen, setRailOpen };
}

// signOut: 下端に置くサインアウトの操作。入口が渡す。2つの枠に1つずつ置かれる。
export function LeftPanel({ signOut }: { signOut: ReactNode }) {
  const { drawerOpen, setDrawerOpen, railOpen, setRailOpen } = useOpenState();

  return (
    <>
      <MobileMenuBar onOpen={() => setDrawerOpen(true)} />

      {drawerOpen && <Scrim onClose={() => setDrawerOpen(false)} />}

      <DrawerFrame
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        signOut={signOut}
      />

      <RailFrame
        open={railOpen}
        onToggle={() => setRailOpen(!railOpen)}
        signOut={signOut}
      />
    </>
  );
}

function DrawerFrame({
  open,
  onClose,
  signOut,
}: {
  open: boolean;
  onClose: () => void;
  signOut: ReactNode;
}) {
  const t = useTranslations("navigation");
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-64 -translate-x-full flex-col overflow-y-auto border-r bg-card text-card-foreground transition-transform duration-200 md:hidden",
        open && "translate-x-0",
      )}
    >
      <div className="flex items-center justify-between gap-2 p-4">
        <LogoLink />
        <button
          type="button"
          onClick={onClose}
          aria-label={t("leftPanelCloseMenu")}
        >
          <X className="size-5" />
        </button>
      </div>

      <PanelBody collapsed={false} signOut={signOut} />
    </aside>
  );
}

function RailFrame({
  open,
  onToggle,
  signOut,
}: {
  open: boolean;
  onToggle: () => void;
  signOut: ReactNode;
}) {
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col overflow-y-auto border-r bg-card text-card-foreground transition-[width] duration-200 max-md:hidden",
        open ? "w-56" : "w-14",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 p-4",
          !open && "justify-center",
        )}
      >
        <LogoLink className={cn(!open && "hidden")} />
        <ToggleButton open={open} onClick={onToggle} />
      </div>

      <PanelBody collapsed={!open} signOut={signOut} />
    </aside>
  );
}

function LogoLink({ className }: { className?: string }) {
  return (
    <Link href={HOME_PATH} className={cn("shrink-0", className)}>
      <LogoImage />
    </Link>
  );
}

// collapsed: 縦の列の格納時に、中身を隠す。
function PanelBody({
  collapsed,
  signOut,
}: {
  collapsed: boolean;
  signOut: ReactNode;
}) {
  const t = useTranslations("navigation");
  return (
    <>
      <nav
        className={cn("flex flex-1 flex-col gap-1 px-4", collapsed && "hidden")}
      >
        <Link
          href={ROUNDS_PATH}
          className="rounded-lg bg-muted px-3 py-2 text-sm font-medium"
        >
          {t("leftPanelPersonal")}
        </Link>
      </nav>

      <div className={cn("border-t p-4", collapsed && "hidden")}>{signOut}</div>
    </>
  );
}

// ドロワーの開き口。1つの要素で、縦向きは上端の横のバー、横向きは左端の縦の帯(ハンバーガーだけ)の形になる。
function MobileMenuBar({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations("navigation");
  return (
    <div className="flex shrink-0 items-center border-b p-3 md:hidden max-md:landscape:w-14 max-md:landscape:items-start max-md:landscape:justify-center max-md:landscape:border-r max-md:landscape:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("leftPanelOpenMenu")}
        className="flex items-center gap-2 text-sm"
      >
        <Menu className="size-5" />
        <span className="max-md:landscape:hidden">
          {t("leftPanelPersonal")}
        </span>
      </button>
    </div>
  );
}

function Scrim({ onClose }: { onClose: () => void }) {
  const t = useTranslations("navigation");
  return (
    <button
      type="button"
      aria-label={t("leftPanelCloseMenu")}
      onClick={onClose}
      className="fixed inset-0 z-40 bg-black/40 md:hidden"
    />
  );
}

function ToggleButton({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("navigation");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? t("leftPanelCollapse") : t("leftPanelExpand")}
      data-testid="left-panel-toggle-wide"
      className="shrink-0"
    >
      {open ? (
        <ChevronLeft className="size-5" />
      ) : (
        <ChevronRight className="size-5" />
      )}
    </button>
  );
}
