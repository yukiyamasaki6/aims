"use client";

import { House, ListOrdered, Menu, Plus, Settings, X } from "lucide-react";
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
  NEW_ROUND_PATH,
  ROUNDS_HISTORY_PATH,
  ROUNDS_HOME_PATH,
  SETTINGS_ACCOUNT_HASH,
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
// skipReturn: 真のとき、閉じてもメニューボタンへ戻さない(「設定」項目で閉じたとき。フォーカスは開いた設定パネルが受け取る)。閉じたときに偽へ戻す。
function usePanelFocus(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLButtonElement | null>,
  skipReturn?: RefObject<boolean>,
) {
  const wasOpen = useRef(open);
  useEffect(() => {
    const panel = panelRef.current;
    if (!open && wasOpen.current && skipReturn?.current) {
      skipReturn.current = false;
    } else if (open && !wasOpen.current) {
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
  }, [open, panelRef, menuRef, skipReturn]);
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

// 設定パネルが閉じたときの、キーボードのフォーカスの戻し先の種類。
// opener: 開き口(幅768px以上で列が開いていれば列の「設定」項目、列が閉じていれば列用のメニューボタン、幅768px未満ではドロワー用のメニューボタン)。
// content: 背景の画面の先頭(本文領域)。
type SettingsCloseFocus = "opener" | "content";

// 設定パネルとの接点。入口が設定の経路の操作から渡す。
// open: 設定パネルが開いているか。onOpen: 開く操作。closeFocus: 閉じたときの戻し先の種類。
export type LeftPanelSettings = {
  open: boolean;
  onOpen: () => void;
  closeFocus: SettingsCloseFocus;
};

type SettingsFocusTargets = {
  wide: boolean;
  railOpen: boolean;
  railSettingsRef: RefObject<HTMLAnchorElement | null>;
  railMenuRef: RefObject<HTMLButtonElement | null>;
  drawerMenuRef: RefObject<HTMLButtonElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
};

function settingsFocusTarget(
  closeFocus: SettingsCloseFocus,
  targets: SettingsFocusTargets,
): HTMLElement | null {
  if (closeFocus === "content") return targets.contentRef.current;
  if (!targets.wide) return targets.drawerMenuRef.current;
  return targets.railOpen
    ? targets.railSettingsRef.current
    : targets.railMenuRef.current;
}

// 設定パネルが閉じたら、戻し先の種類に従ってフォーカスを移す。ドロワーと列の開閉は変えない。初回は移さない。
function useSettingsCloseFocus(
  { open, closeFocus }: LeftPanelSettings,
  targets: SettingsFocusTargets,
) {
  const wasOpen = useRef(open);
  // 戻し先は閉じた時点の幅と列の開閉で決める。targetsは描画ごとに作るため、閉じた描画のものを使う。
  useEffect(() => {
    if (!open && wasOpen.current)
      settingsFocusTarget(closeFocus, targets)?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open, closeFocus, targets]);
}

// 「設定」項目と、設定パネルが閉じたときのフォーカス。
// nav: 項目の押下と現在のビュー。「設定」項目の押下は、ドロワーを閉じ(列は変えない)、設定パネルを開く。ドロワーを閉じるときは、フォーカスをメニューボタンへ移さない(開いた設定パネルが受け取る)。
// skipDrawerReturn: ドロワーを閉じたときにメニューボタンへ戻さない印。
function useSettingsItem(
  settings: LeftPanelSettings,
  panel: {
    drawerOpen: boolean;
    closeDrawer: () => void;
    wide: boolean;
    railOpen: boolean;
    drawerMenuRef: RefObject<HTMLButtonElement | null>;
    railMenuRef: RefObject<HTMLButtonElement | null>;
  },
) {
  const railSettingsRef = useRef<HTMLAnchorElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const skipDrawerReturn = useRef(false);
  const {
    drawerOpen,
    closeDrawer,
    wide,
    railOpen,
    drawerMenuRef,
    railMenuRef,
  } = panel;
  useSettingsCloseFocus(settings, {
    wide,
    railOpen,
    railSettingsRef,
    railMenuRef,
    drawerMenuRef,
    contentRef,
  });
  const openSettings = () => {
    if (drawerOpen) skipDrawerReturn.current = true;
    closeDrawer();
    settings.onOpen();
  };
  const nav: PanelNav = {
    onNavigate: closeDrawer,
    onOpenSettings: openSettings,
  };
  return { railSettingsRef, contentRef, skipDrawerReturn, nav };
}

// children: 本文領域。settings: 設定パネルとの接点。
export function LeftPanel({
  children,
  settings,
}: {
  children: ReactNode;
  settings: LeftPanelSettings;
}) {
  const { drawerOpen, setDrawerOpen, railOpen, setRailOpen } = useOpenState();
  // ホーム・点数一覧・設定の項目の押下は、ドロワーの値だけを閉にする。列の値は変えない。
  const closeDrawer = () => setDrawerOpen(false);
  const closeRail = () => setRailOpen(false);
  const wide = useWide();
  const trapActive = drawerOpen && !wide;
  const swipe = useDrawerSwipe(closeDrawer);
  const drawerRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const drawerMenuRef = useRef<HTMLButtonElement>(null);
  const railMenuRef = useRef<HTMLButtonElement>(null);
  const item = useSettingsItem(settings, {
    drawerOpen,
    closeDrawer,
    wide,
    railOpen,
    drawerMenuRef,
    railMenuRef,
  });
  usePanelFocus(drawerOpen, drawerRef, drawerMenuRef, item.skipDrawerReturn);
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
        nav={item.nav}
        swipe={swipe.handlers}
        offset={swipe.offset}
        dragging={swipe.dragging}
      />

      <RailFrame
        railRef={railRef}
        open={railOpen}
        onClose={closeRail}
        nav={{ ...item.nav, settingsRef: item.railSettingsRef }}
      />

      <ContentArea
        contentRef={item.contentRef}
        inert={trapActive}
        drawerMenuRef={drawerMenuRef}
        railMenuRef={railMenuRef}
        railOpen={railOpen}
        onOpenDrawer={() => setDrawerOpen(true)}
        onOpenRail={() => setRailOpen(true)}
      >
        {children}
      </ContentArea>
    </>
  );
}

// 本文領域。メニューの部品(ドロワー用と、列が閉じている間の列用のメニューボタン)を文脈で画面へ渡す。
// 設定パネルを読み込み時の表示で閉じたときに、フォーカスを受ける(tabIndex=-1)。
function ContentArea({
  contentRef,
  inert,
  drawerMenuRef,
  railMenuRef,
  railOpen,
  onOpenDrawer,
  onOpenRail,
  children,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  inert: boolean;
  drawerMenuRef: RefObject<HTMLButtonElement | null>;
  railMenuRef: RefObject<HTMLButtonElement | null>;
  railOpen: boolean;
  onOpenDrawer: () => void;
  onOpenRail: () => void;
  children: ReactNode;
}) {
  return (
    <div
      ref={contentRef}
      tabIndex={-1}
      inert={inert}
      className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
    >
      <ScreenMenuProvider
        menu={
          <>
            <MenuButton
              buttonRef={drawerMenuRef}
              onOpen={onOpenDrawer}
              className="md:hidden"
            />
            {!railOpen && (
              <MenuButton
                buttonRef={railMenuRef}
                onOpen={onOpenRail}
                className="max-md:hidden"
              />
            )}
          </>
        }
      >
        {children}
      </ScreenMenuProvider>
    </div>
  );
}

function DrawerFrame({
  drawerRef,
  open,
  onClose,
  nav,
  swipe,
  offset,
  dragging,
}: {
  drawerRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  nav: PanelNav;
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

      <PanelBody nav={nav} />
    </aside>
  );
}

// 幅は外枠が切り取り、内枠は固定幅にする。閉じる途中で中身が折り返さず、境界線も幅0で消える。
function RailFrame({
  railRef,
  open,
  onClose,
  nav,
}: {
  railRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  nav: PanelNav;
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
        <PanelBody nav={nav} />
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

function navItemClassName(current: boolean) {
  return cn(
    "flex items-center gap-2 rounded-lg px-3 py-3 text-sm transition-colors",
    current ? "bg-foreground/10 font-medium" : "hover:bg-foreground/5",
  );
}

// 現在のビューの項目に、aria-current="page"と現在の見た目を付ける。パスが項目の行き先と等しい項目に付け、設定パネルの開閉には依らない。詳細・ラウンドの開始画面ではホーム・履歴のどちらにも付かない。
function NavItem({
  href,
  onNavigate,
  children,
}: {
  href: string;
  onNavigate: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const current = pathname === href;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={current ? "page" : undefined}
      className={navItemClassName(current)}
    >
      {children}
    </Link>
  );
}

// 項目の押下と現在のビュー。onNavigate: ホーム・点数一覧の項目の押下。onOpenSettings: 「設定」項目の押下。
// settingsRef: 「設定」項目の要素(列だけが渡す。閉じたときのフォーカスの戻し先)。
type PanelNav = {
  onNavigate: () => void;
  onOpenSettings: () => void;
  settingsRef?: RefObject<HTMLAnchorElement | null>;
};

// ラウンドの開始画面への入口。押すとドロワーを閉じる。開始画面を表示中は遷移を止め、画面の選択を保つ。
function StartRoundLink({ onNavigate }: { onNavigate: () => void }) {
  const t = useTranslations("navigation");
  const pathname = usePathname();
  return (
    <div className="px-2 pt-1 pb-5">
      <Link
        href={NEW_ROUND_PATH}
        onClick={(event) => {
          if (pathname === NEW_ROUND_PATH) event.preventDefault();
          onNavigate();
        }}
        // transition-allだと継承したvisibilityの切替が遅れ、閉じたパネルの中身が閉じた後も届く。色だけに限る。
        className="flex w-full items-center gap-2 rounded-lg px-3 py-3 font-medium text-sm transition-colors hover:bg-foreground/5"
      >
        <Plus aria-hidden="true" className="size-5 shrink-0" />
        {t("leftPanelStartRound")}
      </Link>
    </div>
  );
}

function PanelBody({ nav }: { nav: PanelNav }) {
  const t = useTranslations("navigation");
  return (
    <>
      <StartRoundLink onNavigate={nav.onNavigate} />

      <nav className="flex flex-1 flex-col px-2">
        <NavItem href={ROUNDS_HOME_PATH} onNavigate={nav.onNavigate}>
          <House aria-hidden="true" className="size-5 shrink-0" />
          {t("leftPanelHome")}
        </NavItem>
        <NavItem href={ROUNDS_HISTORY_PATH} onNavigate={nav.onNavigate}>
          <ListOrdered aria-hidden="true" className="size-5 shrink-0" />
          {t("leftPanelHistory")}
        </NavItem>
      </nav>

      <div className="flex flex-col p-2">
        {/* 画面を移らずに設定パネルを開く。hrefは開いたときのハッシュで、押下は既定の動作を止める。 */}
        <a
          ref={nav.settingsRef}
          href={SETTINGS_ACCOUNT_HASH}
          onClick={(event) => {
            event.preventDefault();
            nav.onOpenSettings();
          }}
          className={navItemClassName(false)}
        >
          <Settings aria-hidden="true" className="size-5 shrink-0" />
          {t("leftPanelSettings")}
        </a>
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
      className={cn("flex shrink-0 items-center p-1", className)}
    >
      <Menu className="size-6" />
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
