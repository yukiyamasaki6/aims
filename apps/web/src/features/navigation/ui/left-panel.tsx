"use client";

import { ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, type TouchEvent, useRef, useState } from "react";
import { LogoImage } from "@/components/logo-image";
import { cn } from "@/lib/utils";
import { HOME_PATH, ROUNDS_HISTORY_PATH, ROUNDS_HOME_PATH } from "@/routes";

// 画面の幅768px未満のドロワーと、768px以上の縦の列は別の枠で、それぞれの開閉を持つ。初期値は固定で、幅で分岐しない。
function useOpenState() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  return { drawerOpen, setDrawerOpen, railOpen, setRailOpen };
}

type SwipeStart = {
  x: number;
  y: number;
  direction: "pending" | "horizontal" | "ignored";
};

function useDrawerSwipe(onClose: () => void) {
  const start = useRef<SwipeStart | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    start.current = null;
    setDragging(false);
    setOffset(0);
  };

  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    start.current = touch
      ? { x: touch.clientX, y: touch.clientY, direction: "pending" }
      : null;
  };

  const onTouchMove = (event: TouchEvent) => {
    const origin = start.current;
    const touch = event.touches[0];
    if (!origin || !touch || event.touches.length !== 1) return;

    const horizontal = touch.clientX - origin.x;
    const vertical = touch.clientY - origin.y;
    if (
      origin.direction === "pending" &&
      Math.max(Math.abs(horizontal), Math.abs(vertical)) > 8
    ) {
      origin.direction =
        horizontal < 0 && Math.abs(horizontal) > Math.abs(vertical) * 1.2
          ? "horizontal"
          : "ignored";
      if (origin.direction === "horizontal") setDragging(true);
    }
    if (origin.direction === "horizontal")
      setOffset(Math.min(0, Math.max(-256, horizontal)));
  };

  const onTouchEnd = (event: TouchEvent) => {
    const origin = start.current;
    const touch = event.changedTouches[0];
    if (origin?.direction === "horizontal") event.preventDefault();
    const shouldClose =
      origin?.direction === "horizontal" &&
      touch &&
      touch.clientX - origin.x < -64;
    reset();
    if (shouldClose) onClose();
  };

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: reset },
    offset,
    dragging,
  };
}

// signOut: 下端に置くサインアウトの操作。入口が渡す。2つの枠に1つずつ置かれる。
export function LeftPanel({ signOut }: { signOut: ReactNode }) {
  const { drawerOpen, setDrawerOpen, railOpen, setRailOpen } = useOpenState();
  // ホーム・履歴の項目の押下は、ドロワーの値だけを閉にする。列の値は変えない。
  const closeDrawer = () => setDrawerOpen(false);
  const swipe = useDrawerSwipe(closeDrawer);

  return (
    <>
      <MobileMenuBar onOpen={() => setDrawerOpen(true)} />

      <Scrim
        open={drawerOpen}
        onClose={closeDrawer}
        swipe={swipe.handlers}
        offset={swipe.offset}
        dragging={swipe.dragging}
      />

      <DrawerFrame
        open={drawerOpen}
        onClose={closeDrawer}
        onNavigate={closeDrawer}
        signOut={signOut}
        swipe={swipe.handlers}
        offset={swipe.offset}
        dragging={swipe.dragging}
      />

      <RailFrame
        open={railOpen}
        onToggle={() => setRailOpen(!railOpen)}
        onNavigate={closeDrawer}
        signOut={signOut}
      />
    </>
  );
}

function DrawerFrame({
  open,
  onClose,
  onNavigate,
  signOut,
  swipe,
  offset,
  dragging,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: () => void;
  signOut: ReactNode;
  swipe: ReturnType<typeof useDrawerSwipe>["handlers"];
  offset: number;
  dragging: boolean;
}) {
  const t = useTranslations("navigation");
  return (
    <aside
      {...swipe}
      style={{
        transform: `translateX(${offset}px)`,
        touchAction: "pan-y pinch-zoom",
      }}
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-64 -translate-x-full flex-col overflow-y-auto border-r bg-card text-card-foreground md:hidden",
        dragging
          ? "transition-none"
          : "transition-[transform,translate,visibility] duration-200",
        open ? "translate-x-0" : "invisible",
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

      <PanelBody collapsed={false} onNavigate={onNavigate} signOut={signOut} />
    </aside>
  );
}

function RailFrame({
  open,
  onToggle,
  onNavigate,
  signOut,
}: {
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
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

      <PanelBody collapsed={!open} onNavigate={onNavigate} signOut={signOut} />
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

// 現在のビュー(パスが項目の行き先と等しい)の項目に、aria-current="page"と現在の見た目を付ける。詳細・作成ではどの項目にも付かない。
function NavItem({
  href,
  onNavigate,
  children,
}: {
  href: string;
  onNavigate: () => void;
  children: ReactNode;
}) {
  const current = usePathname() === href;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={current ? "page" : undefined}
      className={cn(
        "rounded-lg px-3 py-2 text-sm",
        current && "bg-muted font-medium",
      )}
    >
      {children}
    </Link>
  );
}

// collapsed: 縦の列の格納時に、中身を隠す。onNavigate: ホーム・履歴の項目の押下で呼ぶ。
function PanelBody({
  collapsed,
  onNavigate,
  signOut,
}: {
  collapsed: boolean;
  onNavigate: () => void;
  signOut: ReactNode;
}) {
  const t = useTranslations("navigation");
  return (
    <>
      <nav
        className={cn("flex flex-1 flex-col gap-1 px-4", collapsed && "hidden")}
      >
        <NavItem href={ROUNDS_HOME_PATH} onNavigate={onNavigate}>
          {t("leftPanelHome")}
        </NavItem>
        <NavItem href={ROUNDS_HISTORY_PATH} onNavigate={onNavigate}>
          {t("leftPanelHistory")}
        </NavItem>
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
        className="flex items-center"
      >
        <Menu className="size-5" />
      </button>
    </div>
  );
}

function Scrim({
  open,
  onClose,
  swipe,
  offset,
  dragging,
}: {
  open: boolean;
  onClose: () => void;
  swipe: ReturnType<typeof useDrawerSwipe>["handlers"];
  offset: number;
  dragging: boolean;
}) {
  const t = useTranslations("navigation");
  return (
    <button
      {...swipe}
      style={{
        opacity: open ? Math.max(0, 1 + offset / 256) : 0,
        touchAction: "pan-y pinch-zoom",
      }}
      type="button"
      aria-label={t("leftPanelCloseMenu")}
      aria-hidden={!open}
      tabIndex={open ? 0 : -1}
      onClick={onClose}
      className={cn(
        "fixed inset-0 z-40 bg-black/40 md:hidden",
        dragging
          ? "transition-none"
          : "transition-[opacity,visibility] duration-200",
        open ? "visible" : "invisible pointer-events-none",
      )}
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
