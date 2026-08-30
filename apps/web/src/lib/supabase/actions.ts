"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

// パスワード再設定用のリンク生成は既存ユーザーにのみ成功するため、
// メールを送らずにアカウントの存在有無だけを判定する手段として使う。
export async function isEmailRegistered(email: string): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  return !error;
}
