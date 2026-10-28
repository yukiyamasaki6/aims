import type { SupabaseClient } from "@supabase/supabase-js";

// パスワード再設定用のリンク生成は既存ユーザーにのみ成功するため、
// メールを送らずにアカウントの存在有無だけを判定する手段として使う。
// enable_confirmations = trueのため、実際に認証コードを確認するまで
// email_confirmed_atは確定しない。未確認のまま放置されたレコードを
// 誤って既存登録と判定することはない。
export function createSupabaseRegistrationCheck(
  getAdminClient: () => Pick<SupabaseClient, "auth">,
): (email: string) => Promise<boolean> {
  return async (email) => {
    const { data, error } = await getAdminClient().auth.admin.generateLink({
      type: "recovery",
      email,
    });

    if (error) {
      // 利用者が見つからないときだけ、未登録とする。
      // それ以外(管理側を使えない、届かない)は確かめられなかったため投げる。手続きが通信エラーとして扱い、コードを送らない。
      if (error.code === "user_not_found") return false;
      throw error;
    }

    return Boolean(data.user?.email_confirmed_at);
  };
}
