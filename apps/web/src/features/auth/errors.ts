import { authErrorMessage } from "./infrastructure/supabase-auth-failure";
import type { SessionState } from "./session-state";

export const AUTH_REQUIRED_MESSAGE = "サインインが必要です。";

// 未認証はサインインを促し、不明（通信失敗）は通信できないことを示す。
export function sessionFailureMessage(
  state: Exclude<SessionState, { status: "authenticated" }>,
): string {
  return state.status === "unauthenticated"
    ? AUTH_REQUIRED_MESSAGE
    : authErrorMessage(state.error);
}
