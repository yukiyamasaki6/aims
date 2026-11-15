"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  type RefObject,
  type TouchEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { LogoImage } from "@/components/logo-image";
import { ScreenMenuProvider } from "@/components/screen-frame";
import { cn } from "@/lib/utils";
import {
  HOME_PATH,
  ROUNDS_HISTORY_PATH,
  ROUNDS_HOME_PATH,
  SETTINGS_PATH,
} from "@/routes";

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

// パネル(ドロワーか縦の列)を開いたらパネルの中へフォーカスを移し、閉じたらメニューボタンへ戻す。初回は移さない。
// メニューボタンは本文側(DOMでパネルより後)にあり、Tabだけではパネルに入れないため。
function usePanelFocus(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLButtonElement | null>,
) {
  const wasOpen = useRef(open);
  useEffect(() => {
    const panel = panelRef.current;
    if (open && !wasOpen.current) {
      // 幅の動き始めに焦点を当てると、overflow-hiddenの外枠が焦点の要素を見せようと内側へスクロールし、開く途中で中身がずれて動く。スクロールさせない。
      panel
        ?.querySelector<HTMLElement>("button")
        ?.focus({ preventScroll: true });
    } else if (!open && wasOpen.current) {
      const active = document.activeElement;
      if (!active || active === document.body || panel?.contains(active))
        menuRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open, panelRef, menuRef]);
}

const WIDE_QUERY = "(min-width: 768px)";

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// 幅768px以上か。サーバーと水和時はfalse。ドロワーの閉じ込めの有効判定だけに使う。
function useWide() {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

// ドロワーの中のフォーカス可能な要素(閉じるボタン、ロゴ、各項目)の内で、Tabを巡回させる。フォーカスが外にあればTabで先頭、Shift+Tabで末尾へ入れる。
function trapTab(event: KeyboardEvent, drawer: HTMLElement) {
  const items = [...drawer.querySelectorAll<HTMLElement>("button, a[href]")];
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  const inside = active instanceof Node && drawer.contains(active);
  if (event.shiftKey && (!inside || active === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}

// ドロワーが開いていて幅768px未満の間だけ、Escで閉じ、Tabをドロワーの中に閉じ込める。
function useDrawerTrap(
  active: boolean,
  drawerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const drawer = drawerRef.current;
      if (event.key === "Escape") onClose();
      else if (event.key === "Tab" && drawer) trapTab(event, drawer);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, drawerRef, onClose]);
}

export function LeftPanel({ children }: { children: ReactNode }) {
  const { drawerOpen, setDrawerOpen, railOpen, setRailOpen } = useOpenState();
  // ホーム・履歴の項目の押下は、ドロワーの値だけを閉にする。列の値は変えない。
  const closeDrawer = () => setDrawerOpen(false);
  const closeRail = () => setRailOpen(false);
  const wide = useWide();
  const trapActive = drawerOpen && !wide;
  const swipe = useDrawerSwipe(closeDrawer);
  const drawerRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const drawerMenuRef = useRef<HTMLButtonElement>(null);
  const railMenuRef = useRef<HTMLButtonElement>(null);
  usePanelFocus(drawerOpen, drawerRef, drawerMenuRef);
  usePanelFocus(railOpen, railRef, railMenuRef);
  useDrawerTrap(trapActive, drawerRef, closeDrawer);

  return (
    <>
      <Scrim
        open={drawerOpen}
        onClose={closeDrawer}
        swipe={swipe.handlers}
        offset={swipe.offset}
        dragging={swipe.dragging}
      />

      <DrawerFrame
        drawerRef={drawerRef}
        open={drawerOpen}
        onClose={closeDrawer}
        onNavigate={closeDrawer}
        swipe={swipe.handlers}
        offset={swipe.offset}
        dragging={swipe.dragging}
      />

      <RailFrame
        railRef={railRef}
        open={railOpen}
        onClose={closeRail}
        onNavigate={closeDrawer}
      />

      <div inert={trapActive} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ScreenMenuProvider
          menu={
            <>
              <MenuButton
                buttonRef={drawerMenuRef}
                onOpen={() => setDrawerOpen(true)}
                className="md:hidden"
              />
              {!railOpen && (
                <MenuButton
                  buttonRef={railMenuRef}
                  onOpen={() => setRailOpen(true)}
                  className="max-md:hidden"
                />
              )}
            </>
          }
        >
          {children}
        </ScreenMenuProvider>
      </div>
    </>
  );
}

function DrawerFrame({
  drawerRef,
  open,
  onClose,
  onNavigate,
  swipe,
  offset,
  dragging,
}: {
  drawerRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  onNavigate: () => void;
  swipe: ReturnType<typeof useDrawerSwipe>["handlers"];
  offset: number;
  dragging: boolean;
}) {
  return (
    <aside
      ref={drawerRef}
      {...swipe}
      style={{
        transform: `translateX(${offset}px)`,
        touchAction: "pan-y pinch-zoom",
      }}
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-64 -translate-x-full flex-col overflow-y-auto border-r bg-card text-card-foreground md:hidden",
        // 開くときはvisibilityを即時に変える(開いた直後のfocus()が効くように)。閉じるときだけ、動きの終わりまで見せる。
        dragging
          ? "transition-none"
          : open
            ? "transition-[transform,translate] duration-200"
            : "transition-[transform,translate,visibility] duration-200",
        open ? "translate-x-0" : "invisible",
      )}
    >
      <PanelTopRow onClose={onClose} />

      <PanelBody onNavigate={onNavigate} />
    </aside>
  );
}

// 幅は外枠が切り取り、内枠は固定幅にする。閉じる途中で中身が折り返さず、境界線も幅0で消える。
function RailFrame({
  railRef,
  open,
  onClose,
  onNavigate,
}: {
  railRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  onNavigate: () => void;
}) {
  return (
    <aside
      ref={railRef}
      className={cn(
        "shrink-0 overflow-hidden max-md:hidden",
        // 開くときはvisibilityを即時に変える(開いた直後のfocus()が効くように)。閉じるときだけ、動きの終わりまで見せる。
        open
          ? "w-56 transition-[width] duration-200"
          : "invisible w-0 transition-[width,visibility] duration-200",
      )}
    >
      <div className="flex h-full w-56 flex-col overflow-y-auto border-r bg-card text-card-foreground">
        <PanelTopRow onClose={onClose} />
        <PanelBody onNavigate={onNavigate} />
      </div>
    </aside>
  );
}

// ドロワーと縦の列に共通の最上段。画面のヘッダー行と同じ高さ45pxで、下線は引かない。
// 中身はヘッダーの線を除いた行と同じ上端から44pxの範囲に置き、アイコンとロゴの位置をヘッダーと揃える。
function PanelTopRow({ onClose }: { onClose: () => void }) {
  const t = useTranslations("navigation");
  return (
    <div className="h-[45px] shrink-0">
      <div className="flex h-11 items-center gap-2 px-1.5">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("leftPanelCloseMenu")}
          className="flex shrink-0 items-center p-1.5"
        >
          <X className="size-5" />
        </button>
        <LogoLink />
      </div>
    </div>
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

// onNavigate: ホーム・履歴の項目の押下で呼ぶ。
function PanelBody({ onNavigate }: { onNavigate: () => void }) {
  const t = useTranslations("navigation");
  return (
    <>
      <nav className="flex flex-1 flex-col gap-1 px-4 pt-1">
        <NavItem href={ROUNDS_HOME_PATH} onNavigate={onNavigate}>
          {t("leftPanelHome")}
        </NavItem>
        <NavItem href={ROUNDS_HISTORY_PATH} onNavigate={onNavigate}>
          {t("leftPanelHistory")}
        </NavItem>
      </nav>

      <div className="flex flex-col border-t p-4">
        <NavItem href={SETTINGS_PATH} onNavigate={onNavigate}>
          {t("leftPanelSettings")}
        </NavItem>
      </div>
    </>
  );
}

// ドロワーと縦の列の開き口。画面のヘッダー行の先頭に、ScreenFrameが置く。className: 表示する幅の指定。
function MenuButton({
  onOpen,
  buttonRef,
  className,
}: {
  onOpen: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  className: string;
}) {
  const t = useTranslations("navigation");
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onOpen}
      aria-label={t("leftPanelOpenMenu")}
      className={cn("flex shrink-0 items-center p-1.5", className)}
    >
      <Menu className="size-5" />
    </button>
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
      aria-hidden
      tabIndex={-1}
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
