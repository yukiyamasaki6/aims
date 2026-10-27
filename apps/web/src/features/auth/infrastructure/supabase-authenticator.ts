import type { SupabaseClient } from "@supabase/supabase-js";
import type { SignInAuthenticator } from "../application/sign-in";
import { toFailure } from "./supabase-auth-call";

// 接続は、作る関数を受け取り、照合のたびにtryの中で取得する(環境変数の欠落は届かない失敗になる)。ブラウザでは同じ接続が返る。
export function createSupabaseAuthenticator(
  getClient: () => Pick<SupabaseClient, "auth">,
): SignInAuthenticator {
  return {
    signIn: ({ email, password, captchaToken }) =>
      toFailure(() =>
        getClient().auth.signInWithPassword({
          email,
          password,
          options: { captchaToken },
        }),
      ),
  };
}
