import type { SupabaseClient } from "@supabase/supabase-js";
import type { Registration, SignUpAuthenticator } from "../application/sign-up";
import { toDelivery, toFailure } from "./supabase-auth-call";

// 接続は、作る関数を受け取り、操作のたびにtryの中で取得する(環境変数の欠落は届かない失敗になる)。
// 登録済みの判定は、サーバーの関数を受け取って呼ぶ。
export function createSupabaseSignUpAuthenticator({
  getClient,
  isEmailRegistered,
}: {
  getClient: () => Pick<SupabaseClient, "auth">;
  isEmailRegistered: (email: string) => Promise<boolean>;
}): SignUpAuthenticator {
  return {
    async isRegistered(email): Promise<Registration> {
      try {
        return (await isEmailRegistered(email))
          ? { kind: "registered" }
          : { kind: "unregistered" };
      } catch {
        return { kind: "unreached" };
      }
    },
    sendCode: ({ email, captchaToken }) =>
      toDelivery(() =>
        getClient().auth.signInWithOtp({ email, options: { captchaToken } }),
      ),
    verifyCode: ({ email, code }) =>
      toFailure(() =>
        getClient().auth.verifyOtp({ email, token: code, type: "email" }),
      ),
    setPassword: (password) =>
      toFailure(() => getClient().auth.updateUser({ password })),
  };
}
