import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResetPasswordAuthenticator } from "../application/reset-password";
import { toDelivery, toFailure } from "./supabase-auth-call";

// 接続は、作る関数を受け取り、操作のたびにtryの中で取得する(環境変数の欠落は届かない失敗になる)。
export function createSupabaseResetPasswordAuthenticator({
  getClient,
}: {
  getClient: () => Pick<SupabaseClient, "auth">;
}): ResetPasswordAuthenticator {
  return {
    sendCode: ({ email, captchaToken }) =>
      toDelivery(() =>
        getClient().auth.resetPasswordForEmail(email, { captchaToken }),
      ),
    verifyCode: ({ email, code }) =>
      toFailure(() =>
        getClient().auth.verifyOtp({ email, token: code, type: "recovery" }),
      ),
    setPassword: (password) =>
      toFailure(() => getClient().auth.updateUser({ password })),
    // scopeを指定しない(既定のglobal)ため、その利用者の全ての端末のサインインが終わる。
    // 認証サービスが値のエラーを返しても、変更前と同じく遷移を妨げない(応答があれば終了を依頼できたとする)。
    signOutEverywhere: () =>
      toFailure(async () => {
        await getClient().auth.signOut();
        return { error: null };
      }),
  };
}
