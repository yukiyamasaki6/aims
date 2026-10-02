import type { AuthError, Session } from "@supabase/supabase-js";

export type SessionState =
  | { status: "authenticated"; session: Session }
  | { status: "unauthenticated" }
  | { status: "unknown"; error: AuthError };

// 通信失敗はセッションが残っていて回復し得るため、未認証と区別する。
export function classifySession(result: {
  data: { session: Session | null };
  error?: AuthError | null;
}): SessionState {
  const { session } = result.data;
  if (session?.user) return { status: "authenticated", session };
  if (result.error?.name === "AuthRetryableFetchError") {
    return { status: "unknown", error: result.error };
  }
  return { status: "unauthenticated" };
}
