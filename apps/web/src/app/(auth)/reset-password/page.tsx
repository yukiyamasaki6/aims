"use client";

import { useState } from "react";
import { createResetPassword } from "@/features/auth/application/reset-password";
import { createBrowserPageLoad } from "@/features/auth/infrastructure/browser-page-load";
import { createSupabaseResetPasswordAuthenticator } from "@/features/auth/infrastructure/supabase-reset-password-authenticator";
import { ResetPasswordForm } from "@/features/auth/ui/reset-password-form";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  // 画面を開いている間、同じ手続きを保つ。接続は、認証の実装が操作のたびに取得する(描画時には作らない)。
  const [resetPassword] = useState(() =>
    createResetPassword({
      authenticator: createSupabaseResetPasswordAuthenticator({
        getClient: createClient,
      }),
      pageLoad: createBrowserPageLoad(),
    }),
  );
  return <ResetPasswordForm resetPassword={resetPassword} />;
}
