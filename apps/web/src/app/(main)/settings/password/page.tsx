"use client";

import { useState } from "react";
import { createChangePassword } from "@/features/auth/application/change-password";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { ChangePasswordForm } from "@/features/auth/ui/change-password-form";
import { createBrowserConnectivity } from "@/lib/connectivity/infrastructure/browser-connectivity";
import { createClient } from "@/lib/supabase/infrastructure/client";

export default function ChangePasswordPage() {
  // 画面を開いている間、同じ手続きを保つ。
  const [changePassword] = useState(() =>
    createChangePassword({
      authenticator: createSupabaseAuth(createClient),
      connectivity: createBrowserConnectivity(),
    }),
  );
  return <ChangePasswordForm changePassword={changePassword} />;
}
