"use client";

import { ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LogoImage } from "@/components/logo-image";
import { Button } from "@/components/ui/button";
import { BlockingConfirmDialog } from "@/components/ui/confirm-dialog";
import { useMountedRef } from "@/hooks/use-mounted-ref";
import { cn } from "@/lib/utils";
import { signOut } from "./sign-out";

// 操作の直後だけ開閉のtransitionを有効にする時間。transitionの200msより少し長い。
const ANIMATE_MS = 250;

function useOpenState() {
  // 利用者が操作するまではnullで、表示ごとの初期状態に従う。操作後は全表示で共有する。
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  // 初回表示と環境の変化(回転、窓の変形)では動かさず、操作の直後だけtrueにする。
  const [animate, setAnimate] = useState(false);
  // 連続操作でタイマーを延ばすため、操作の回数を依存にする。
  const [operations, setOperations] = useState(0);
  useEffect(() => {
    if (operations === 0) return;
    const id = setTimeout(() => setAnimate(false), ANIMATE_MS);
    return () => clearTimeout(id);
  }, [operations]);
  function operate(next: boolean) {
    setAnimate(true);
    setOperations((n) => n + 1);
    setUserOpen(next);
  }
  return {
    wideOpen: userOpen ?? true,
    compactOpen: userOpen ?? false,
    animate,
    operate,
  };
}

export function LeftPanel() {
  const { wideOpen, compactOpen, animate, operate } = useOpenState();
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);
  const mountedRef = useMountedRef();

  async function handleSignOut(): Promise<{ error: string } | undefined> {
    const result = await signOut({ isMounted: () => mountedRef.current });

    if (result.status === "failed") return { error: result.error };
  }

  return (
    <>
      <MobileMenuBar
        open={compactOpen}
        onOpen={() => operate(true)}
        onClose={() => operate(false)}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 -translate-x-full flex-col overflow-y-auto border-r bg-card text-card-foreground side:static side:z-auto side:translate-x-0",
          animate &&
            "transition-transform duration-200 side:transition-[width]",
          compactOpen && "translate-x-0",
          wideOpen ? "md:w-56" : "md:w-14",
          compactOpen ? "max-md:landscape:w-56" : "max-md:landscape:w-14",
        )}
      >
        <PanelHeader
          wideOpen={wideOpen}
          compactOpen={compactOpen}
          onCloseMobile={() => operate(false)}
          onToggleWide={() => operate(!wideOpen)}
          onToggleCompact={() => operate(!compactOpen)}
        />

        <PanelBody
          wideOpen={wideOpen}
          compactOpen={compactOpen}
          onSignOut={() => setSignOutDialogOpen(true)}
        />
      </aside>

      <BlockingConfirmDialog
        open={signOutDialogOpen}
        onOpenChange={setSignOutDialogOpen}
        description="サインアウトしますか？"
        confirmLabel="サインアウトする"
        onConfirm={handleSignOut}
      />
    </>
  );
}

function PanelBody({
  wideOpen,
  compactOpen,
  onSignOut,
}: {
  wideOpen: boolean;
  compactOpen: boolean;
  onSignOut: () => void;
}) {
  return (
    <>
      <nav
        className={cn(
          "flex flex-1 flex-col gap-1 px-4",
          !wideOpen && "md:hidden",
          !compactOpen && "max-md:landscape:hidden",
        )}
      >
        <Link
          href="/rounds"
          className="rounded-lg bg-muted px-3 py-2 text-sm font-medium"
        >
          個人
        </Link>
      </nav>

      <div
        className={cn(
          "border-t p-4",
          !wideOpen && "md:hidden",
          !compactOpen && "max-md:landscape:hidden",
        )}
      >
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => onSignOut()}
        >
          サインアウト
        </Button>
      </div>
    </>
  );
}

function MobileMenuBar({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex shrink-0 items-center border-b p-3 side:hidden">
        <button
          type="button"
          onClick={onOpen}
          aria-label="メニューを開く"
          className="flex items-center gap-2 text-sm"
        >
          <Menu className="size-5" />
          個人
        </button>
      </div>

      {open && (
        <button
          type="button"
          aria-label="メニューを閉じる"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 side:hidden"
        />
      )}
    </>
  );
}

function PanelHeader({
  wideOpen,
  compactOpen,
  onCloseMobile,
  onToggleWide,
  onToggleCompact,
}: {
  wideOpen: boolean;
  compactOpen: boolean;
  onCloseMobile: () => void;
  onToggleWide: () => void;
  onToggleCompact: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 p-4",
        !wideOpen && "md:justify-center",
        !compactOpen && "max-md:landscape:justify-center",
      )}
    >
      <Link
        href="/"
        className={cn(
          "shrink-0",
          !wideOpen && "md:hidden",
          !compactOpen && "max-md:landscape:hidden",
        )}
      >
        <LogoImage />
      </Link>
      <button
        type="button"
        onClick={onCloseMobile}
        aria-label="メニューを閉じる"
        className="side:hidden"
      >
        <X className="size-5" />
      </button>
      <ToggleButton
        open={wideOpen}
        onClick={onToggleWide}
        testId="left-panel-toggle-wide"
        className="md:block"
      />
      <ToggleButton
        open={compactOpen}
        onClick={onToggleCompact}
        testId="left-panel-toggle-compact"
        className="max-md:landscape:block"
      />
    </div>
  );
}

// 広い画面と横向きかつ狭い画面でボタンを分け、表示の切替をCSSだけで合わせる。
function ToggleButton({
  open,
  onClick,
  testId,
  className,
}: {
  open: boolean;
  onClick: () => void;
  testId: string;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? "パネルを格納する" : "パネルを開く"}
      data-testid={testId}
      className={cn("hidden shrink-0", className)}
    >
      {open ? (
        <ChevronLeft className="size-5" />
      ) : (
        <ChevronRight className="size-5" />
      )}
    </button>
  );
}
