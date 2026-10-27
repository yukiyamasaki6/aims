import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Delivery,
  Registration,
  SignUpAuthenticator,
} from "../application/sign-up";
import { toAuthFailure } from "./supabase-auth-failure";

const UNREACHED = { kind: "unreached" } as const;
const UNREACHABLE = { kind: "unreachable" } as const;

// 接続は、作る関数を受け取り、操作のたびにtryの中で取得する(環境変数の欠落は届かない失敗になる)。
// 登録済みの判定は、サーバーの関数を受け取って呼ぶ。
// 認証サービスのエラーは値で返ることがあり(応答があった)、呼び出しが投げたときは応答が無かったとして区別する。
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
        return UNREACHED;
      }
    },
    async sendCode({ email, captchaToken }): Promise<Delivery> {
      try {
        const { error } = await getClient().auth.signInWithOtp({
          email,
          options: { captchaToken },
        });
        return error
          ? { kind: "refused", failure: toAuthFailure(error) }
          : { kind: "sent" };
      } catch {
        return UNREACHED;
      }
    },
    async verifyCode({ email, code }) {
      try {
        const { error } = await getClient().auth.verifyOtp({
          email,
          token: code,
          type: "email",
        });
        return error ? toAuthFailure(error) : null;
      } catch {
        return UNREACHABLE;
      }
    },
    async setPassword(password) {
      try {
        const { error } = await getClient().auth.updateUser({ password });
        return error ? toAuthFailure(error) : null;
      } catch {
        return UNREACHABLE;
      }
    },
  };
}
