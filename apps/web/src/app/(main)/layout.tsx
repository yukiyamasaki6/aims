"use client";

import { useEffect, useState } from "react";
import { createSession } from "@/features/auth/application/session";
import { createBrowserPageLoad } from "@/features/auth/infrastructure/browser-page-load";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { SignOutButton } from "@/features/auth/ui/sign-out-button";
import { LeftPanel } from "@/features/navigation/ui/left-panel";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { createClient } from "@/lib/supabase/infrastructure/client";

export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 画面を開いている間、同じ手続きを保つ。
  const [session] = useState(() =>
    createSession({
      authenticator: createSupabaseAuth(createClient),
      connectivity: createBrowserConnectivity(),
      pageReplace: createBrowserPageLoad(),
    }),
  );
  // セッションを失ったら/signinへ移す。認証が要る画面の集合(このレイアウトの下)の間、見張る。
  useEffect(() => session.watch(), [session]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden side:flex-row">
      <LeftPanel signOut={<SignOutButton signOut={session.signOut} />} />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
