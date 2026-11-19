"use client";

import { useState } from "react";
import { createChangeEmail } from "@/features/auth/application/change-email";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { ChangeEmailForm } from "@/features/auth/ui/change-email-form";
import { useDeleteAccount } from "@/features/auth/ui/delete-account-context";
import { DeleteAccountForm } from "@/features/auth/ui/delete-account-form";
import { useSession } from "@/features/auth/ui/session-context";
import { SignOutButton } from "@/features/auth/ui/sign-out-button";
import type { SettingsItemView } from "@/features/settings/domain/settings-location";
import {
  type SettingsItemControls,
  SettingsPanel,
} from "@/features/settings/ui/settings-panel";
import type { SettingsRoute } from "@/features/settings/ui/use-settings-route";
import { createBrowserClock } from "@/lib/clock/infrastructure/browser-clock";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { createClient } from "@/lib/supabase/infrastructure/client";

const siteKey = () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

// 設定パネルの入口。サインアウトの行と項目の画面(認証の部品)を組み立てて、設定パネルへ渡す。
export function SettingsPanelEntry({ route }: { route: SettingsRoute }) {
  const session = useSession();
  return (
    <SettingsPanel
      view={route.view}
      onMove={route.move}
      onClose={route.close}
      signOut={<SignOutButton signOut={session.signOut} />}
      renderItem={(view, controls) => (
        <SettingsItem view={view} controls={controls} />
      )}
    />
  );
}

// 項目の画面。表示が変わると画面ごと外れ、次に開くと手続きも作り直す。
function SettingsItem({
  view,
  controls,
}: {
  view: SettingsItemView;
  controls: SettingsItemControls;
}) {
  switch (view) {
    case "email":
      return <ChangeEmailItem {...controls} />;
    case "delete-account":
      return <DeleteAccountItem {...controls} />;
  }
}

function ChangeEmailItem(controls: SettingsItemControls) {
  // 画面を開いている間、同じ手続きを保つ。
  const [changeEmail] = useState(() =>
    createChangeEmail({
      authenticator: createSupabaseAuth(createClient),
      connectivity: createBrowserConnectivity(),
      clock: createBrowserClock(),
    }),
  );
  return (
    <ChangeEmailForm
      changeEmail={changeEmail}
      siteKey={siteKey()}
      {...controls}
    />
  );
}

function DeleteAccountItem(controls: SettingsItemControls) {
  return (
    <DeleteAccountForm
      deleteAccount={useDeleteAccount()}
      siteKey={siteKey()}
      {...controls}
    />
  );
}
