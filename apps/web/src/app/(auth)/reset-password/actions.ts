"use server";

import { cookies } from "next/headers";
import { createPasswordChange } from "@/features/auth/application/password-change";
import { createSupabaseAuth } from "@/features/auth/infrastructure/supabase-auth";
import { createServerClient } from "@/lib/supabase/server";

// パスワードの変更と全ての端末のサインインの終了を、要求の利用者のセッションで1回の要求として行う。
export async function changePassword(password: string) {
  // 1回の要求では、同じ接続を使う(変更で更新されたセッションを、終了が使うため)。
  const client = createServerClient(await cookies());
  return createPasswordChange({
    authenticator: createSupabaseAuth(() => client),
  }).change(password);
}
