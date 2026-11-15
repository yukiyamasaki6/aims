"use client";

import { useEffect } from "react";
import { useSession } from "@/features/auth/ui/session-context";
import { LeftPanel } from "@/features/navigation/ui/left-panel";
import { useSettingsRoute } from "@/features/settings/ui/use-settings-route";
import { SettingsPanelEntry } from "./settings-panel-entry";

export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // アプリで1つの手続き(入口が生成して渡す)。
  const session = useSession();
  // セッションを失ったら/signinへ移す。認証が要る画面の集合(このレイアウトの下)の間、見張る。
  useEffect(() => session.watch(), [session]);
  // 設定パネルの開閉と表示は、URLのハッシュと履歴から決める。
  const settings = useSettingsRoute();

  // 設定パネルの入口はLeftPanelの外(兄弟)に描く。LeftPanelが本文領域に渡すメニューの文脈を受けず、項目の画面のヘッダーにメニューボタンを出さないため。
  return (
    <div className="flex h-full overflow-hidden">
      <LeftPanel
        settings={{
          open: settings.view !== null,
          onOpen: settings.open,
          closeFocus: settings.closeFocus,
        }}
      >
        {children}
      </LeftPanel>
      <SettingsPanelEntry route={settings} />
    </div>
  );
}
