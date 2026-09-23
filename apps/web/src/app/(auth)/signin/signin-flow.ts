import type { AuthError } from "@supabase/supabase-js";
import { translateAuthErrorMessage } from "@/lib/supabase/errors";
import type { SignInFieldErrors } from "./validate";

const NETWORK_ERROR_MESSAGE =
  "通信エラーが発生しました。しばらくしてから再度お試しください。";

export type SignInState = {
  error: string | null;
  fieldErrors: SignInFieldErrors;
};

export const initialSignInState: SignInState = {
  error: null,
  fieldErrors: {},
};

// 成功時は/roundsへ遷移するのみで状態変化がないため、succeededアクションは持たない。
export type SignInAction =
  | { type: "submit_invalid"; errors: SignInFieldErrors }
  | { type: "submit_started" }
  | { type: "submit_auth_error"; error: AuthError }
  | { type: "submit_network_error" };

export function signinReducer(
  state: SignInState,
  action: SignInAction,
): SignInState {
  switch (action.type) {
    case "submit_invalid":
      return { ...state, error: null, fieldErrors: action.errors };
    case "submit_started":
      return { ...state, error: null, fieldErrors: {} };
    case "submit_auth_error":
      return {
        ...state,
        error: translateAuthErrorMessage(action.error),
        fieldErrors: {},
      };
    case "submit_network_error":
      return { ...state, error: NETWORK_ERROR_MESSAGE, fieldErrors: {} };
  }
}
