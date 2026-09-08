"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { translateAuthErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

// scope未指定だとデフォルトでglobal（そのユーザーの全デバイス・全セッションを
// 無効化）になる。この端末だけのサインアウトを意図しているのでlocalを指定する。
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}

// サインアップ最終ステップ（パスワード設定）の直後のリダイレクトは、Cookie
// 書き込み競合を避けるためServer Action化する。updateUser自体は
// verifyOtpで既に確立済みのセッション（Cookie経由）に対して行われる。
export async function setPassword(
  password: string,
): Promise<{ error: string } | undefined> {
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: translateAuthErrorMessage(error) };
  }

  redirect("/rounds");
}

// パスワード再設定用のリンク生成は既存ユーザーにのみ成功するため、
// メールを送らずにアカウントの存在有無だけを判定する手段として使う。
// enable_confirmations = trueのため、実際に認証コードを確認するまで
// email_confirmed_atは確定しない。未確認のまま放置されたレコードを
// 誤って既存登録と判定することはない。
export async function isEmailRegistered(email: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  if (error) {
    return false;
  }

  return Boolean(data.user?.email_confirmed_at);
}
