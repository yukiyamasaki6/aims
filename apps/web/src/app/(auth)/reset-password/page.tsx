"use client";

import { useState } from "react";
import { createResetPassword } from "@/features/auth/application/reset-password";
import { createBrowserPageLoad } from "@/features/auth/infrastructure/browser-page-load";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { ResetPasswordForm } from "@/features/auth/ui/reset-password-form";
import { createClient } from "@/lib/supabase/client";
import { changePassword } from "./actions";

export default function ResetPasswordPage() {
  // 画面を開いている間、同じ手続きを保つ。
  const [resetPassword] = useState(() =>
    createResetPassword({
      authenticator: createSupabaseAuth(createClient),
      passwordChange: { change: changePassword },
      pageLoad: createBrowserPageLoad(),
    }),
  );
  return <ResetPasswordForm resetPassword={resetPassword} />;
}
