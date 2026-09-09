"use client";

import { ChevronLeft, ChevronRight, Loader2, Menu, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { translateAuthErrorMessage } from "@/lib/supabase/errors";
import { cn } from "@/lib/utils";

export function LeftPanelClient({ isSignedIn }: { isSignedIn: boolean }) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // 二重送信の判定は同期的なrefで行う。setSubmitting()由来のstateはレンダーを
  // 挟むまで更新されず、連打で2回目の呼び出しが古いsubmitting=falseの
  // クロージャのまま実行されてしまうため、stateだけでは防げない。
  const submittingRef = useRef(false);
  const [signOutSubmitting, setSignOutSubmitting] = useState(false);

  useEffect(() => {
    // Strict Modeの開発時二重実行（マウント→クリーンアップ→再マウント）に
    // 対応するため、マウント時にも明示的にtrueへ戻す。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleSignOut() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSignOutSubmitting(true);
    setSignOutError(null);
    try {
      const supabase = createClient();
      // scope未指定だとデフォルトでglobal（そのユーザーの全デバイス・
      // 全セッションを無効化）になる。この端末だけのサインアウトを
      // 意図しているのでlocalを指定する。
      const { error } = await supabase.auth.signOut({ scope: "local" });

      if (!mountedRef.current) return;

      if (error) {
        setSignOutError(translateAuthErrorMessage(error));
        submittingRef.current = false;
        setSignOutSubmitting(false);
        return;
      }

      // 成功時はここでsubmittingを解除しない。router.push()は遷移先の取得中も
      // このコンポーネントを保持し続けるため、ここで解除すると遷移完了前に
      // ボタンが再度押せる状態に戻ってしまう。アンマウント時に自然に破棄される。
      router.push("/");
    } catch {
      if (!mountedRef.current) return;
      setSignOutError(
        "通信エラーが発生しました。しばらくしてから再度お試しください。",
      );
      submittingRef.current = false;
      setSignOutSubmitting(false);
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

      <Dialog
        open={signOutDialogOpen}
        onOpenChange={(open) => {
          // 送信中は背景クリック・Escでは閉じさせない。
          if (!open && submittingRef.current) return;
          setSignOutDialogOpen(open);
          if (!open) setSignOutError(null);
        }}
      >
        <DialogContent>
          <div className="flex flex-col gap-4">
            <p className="text-sm">サインアウトしますか？</p>
            {signOutError && (
              <p className="text-destructive text-sm">{signOutError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                aria-disabled={signOutSubmitting}
                className={cn(
                  signOutSubmitting && "pointer-events-none opacity-50",
                )}
                onClick={() => {
                  if (submittingRef.current) return;
                  setSignOutDialogOpen(false);
                }}
              >
                キャンセル
              </Button>
              <Button
                type="button"
                variant="destructive"
                aria-disabled={signOutSubmitting}
                className={cn(
                  signOutSubmitting && "pointer-events-none opacity-50",
                )}
                onClick={handleSignOut}
              >
                {signOutSubmitting && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                サインアウトする
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
