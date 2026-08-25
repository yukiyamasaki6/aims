"use client";

import { ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/supabase/actions";
import { cn } from "@/lib/utils";

export function LeftPanelClient({ isSignedIn }: { isSignedIn: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);

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
            href="/"
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
          <span className="rounded-lg bg-muted px-3 py-2 text-sm font-medium">
            自分
          </span>
        </nav>

        {isSignedIn && (
          <form
            action={signOut}
            className={cn("border-t p-4", !desktopOpen && "md:hidden")}
          >
            <Button type="submit" variant="outline" className="w-full">
              サインアウト
            </Button>
          </form>
        )}
      </aside>
    </>
  );
}
