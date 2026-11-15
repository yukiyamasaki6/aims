"use client";

import { useEffect } from "react";
import { useSession } from "@/features/auth/ui/session-context";
import { LeftPanel } from "@/features/navigation/ui/left-panel";

export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // アプリで1つの手続き(入口が生成して渡す)。
  const session = useSession();
  // セッションを失ったら/signinへ移す。認証が要る画面の集合(このレイアウトの下)の間、見張る。
  useEffect(() => session.watch(), [session]);

  return (
    <div className="flex h-full overflow-hidden">
      <LeftPanel>{children}</LeftPanel>
    </div>
  );
}
