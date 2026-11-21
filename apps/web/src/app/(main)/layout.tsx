"use client";

import { useEffect, useState } from "react";
import { withoutGoogleReturn } from "@/features/auth/domain/google-return";
import { createBrowserPageAddress } from "@/features/auth/infrastructure/browser-page-address";
import { useLinkGoogle } from "@/features/auth/ui/link-google-context";
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
  const linkGoogle = useLinkGoogle();
  const [address] = useState(createBrowserPageAddress);
  const { open } = settings;
  // 読み込み後に1回、Googleアカウントの追加の戻りを手続きへ渡す。預けられたら、戻りを外したURLに書き換え、設定パネルを分類「アカウント」で開く。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 読み込み後に1回だけ呼ぶ(戻りは外すため、2回目は何もしない)。
  useEffect(() => {
    const search = address.search();
    if (!linkGoogle.capture(search)) return;
    address.rewrite(withoutGoogleReturn(search));
    open();
  }, []);

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
