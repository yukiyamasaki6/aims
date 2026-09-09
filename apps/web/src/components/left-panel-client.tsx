"use client";

import { ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BlockingConfirmDialog } from "@/components/ui/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { translateAuthErrorMessage } from "@/lib/supabase/errors";
import { cn } from "@/lib/utils";

export function LeftPanelClient({ isSignedIn }: { isSignedIn: boolean }) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    // Strict Modeの開発時二重実行（マウント→クリーンアップ→再マウント）に
    // 対応するため、マウント時にも明示的にtrueへ戻す。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleSignOut(): Promise<{ error: string } | undefined> {
    try {
      const supabase = createClient();
      // scope未指定だとデフォルトでglobal（そのユーザーの全デバイス・
      // 全セッションを無効化）になる。この端末だけのサインアウトを
      // 意図しているのでlocalを指定する。
      const { error } = await supabase.auth.signOut({ scope: "local" });

      if (!mountedRef.current) return;

      if (error) {
        return { error: translateAuthErrorMessage(error) };
      }

      router.push("/");
    } catch {
      if (!mountedRef.current) return;
      return {
        error: "通信エラーが発生しました。しばらくしてから再度お試しください。",
      };
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center border-b p-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="メニューを開く"
          className="flex items-center gap-2 text-sm"
        >
          <Menu className="size-5" />
          自分
        </button>
      </div>

      {mobileOpen && (
        <button
          type="button"
          aria-label="メニューを閉じる"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 -translate-x-full flex-col overflow-y-auto border-r bg-card text-card-foreground transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:transition-[width]",
          mobileOpen && "translate-x-0",
          desktopOpen ? "md:w-56" : "md:w-14",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 p-4",
            desktopOpen ? "justify-between" : "md:justify-center",
          )}
        >
          <Link
            href="/rounds"
            className={cn("truncate font-bold", !desktopOpen && "md:hidden")}
          >
            AIMS
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="メニューを閉じる"
            className="md:hidden"
          >
            <X className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => setDesktopOpen((v) => !v)}
            aria-label={desktopOpen ? "パネルを格納する" : "パネルを開く"}
            className="hidden shrink-0 md:block"
          >
            {desktopOpen ? (
              <ChevronLeft className="size-5" />
            ) : (
              <ChevronRight className="size-5" />
            )}
          </button>
        </div>

        <nav
          className={cn(
            "flex flex-1 flex-col gap-1 px-4",
            !desktopOpen && "md:hidden",
          )}
        >
          <Link
            href="/rounds"
            className="rounded-lg bg-muted px-3 py-2 text-sm font-medium"
          >
            自分
          </Link>
        </nav>

        {isSignedIn && (
          <div className={cn("border-t p-4", !desktopOpen && "md:hidden")}>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setSignOutDialogOpen(true)}
            >
              サインアウト
            </Button>
          </div>
        )}
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
