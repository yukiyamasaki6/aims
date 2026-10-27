import type { SupabaseClient } from "@supabase/supabase-js";
import type { SignInAuthenticator } from "../application/sign-in";
import { toAuthFailure } from "./supabase-auth-failure";

// 接続は、作る関数を受け取り、照合のたびにtryの中で取得する(環境変数の欠落は届かない失敗になる)。ブラウザでは同じ接続が返る。
export function createSupabaseAuthenticator(
  getClient: () => Pick<SupabaseClient, "auth">,
): SignInAuthenticator {
  return {
    async signIn({ email, password, captchaToken }) {
      try {
        const { error } = await getClient().auth.signInWithPassword({
          email,
          password,
          options: { captchaToken },
        });
        if (!error) return null;
        return toAuthFailure(error);
      } catch {
        return { kind: "unreachable" };
      }
    },
  };
}
