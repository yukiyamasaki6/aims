import type { AuthFailure, AuthFailureKind } from "./auth-failure";
import { isCaptchaCompleted } from "./captcha-token";
import type { FieldErrors, Start } from "./flow";
import { validatePasswordPresent } from "./password";

// アカウント削除の流れ。開始の可否、入力の検証の順序、失敗の後の状態、セキュリティチェックのトークンの消費を守る集約。

export type DeleteAccountFlow = {
  readonly captchaToken: string | null;
  readonly submitting: boolean;
  readonly fieldErrors: FieldErrors<"currentPassword" | "captcha">;
  readonly error: AuthFailureKind | null;
};

export const initialDeleteAccountFlow: DeleteAccountFlow = {
  captchaToken: null,
  submitting: false,
  fieldErrors: {},
  error: null,
};

// 再認証の入力。現在のパスワードと、チェックのトークン。
export type Reauthentication = {
  readonly password: string;
  readonly captchaToken: string;
};

// 開始の命令。判定の順序は、送信中 → 入力の判定 → オフラインの判定 → チェックの判定。
// 送信中なら開始しない。入力の不備は、現在のパスワードの未入力と、オンラインのときのチェック未完了を全て示す。
// 入力に不備が無くオフラインなら、通信もトークンの消費もせず、オフラインを示す(チェック未完了はオフラインでは示さない。原因を取り違えるため)。
// 開始できるなら送信中にする。開始では以前のエラーを消す。
// 送信中の間はエラーを持たない。
export function beginDeleteAccount(
  flow: DeleteAccountFlow,
  input: { password: string; offline: boolean },
): Start<DeleteAccountFlow, Reauthentication> {
  if (flow.submitting) return { state: flow, request: null };
  const currentPassword = validatePasswordPresent(input.password);
  const { captchaToken } = flow;
  if (input.offline) {
    return currentPassword
      ? {
          state: { ...flow, error: null, fieldErrors: { currentPassword } },
          request: null,
        }
      : {
          state: { ...flow, error: "offline", fieldErrors: {} },
          request: null,
        };
  }
  if (currentPassword || !isCaptchaCompleted(captchaToken)) {
    return {
      state: {
        ...flow,
        error: null,
        fieldErrors: {
          ...(currentPassword && { currentPassword }),
          ...(!isCaptchaCompleted(captchaToken) && { captcha: "incomplete" }),
        },
      },
      request: null,
    };
  }
  return {
    state: { ...flow, submitting: true, error: null, fieldErrors: {} },
    request: { password: input.password, captchaToken },
  };
}

// 画面で起きた事実。開始の命令は含まない(beginDeleteAccount)。
// failed: 削除が行われなかった、または結果が分からない失敗。再認証が使ったトークンは使えないため、成功した再認証の後の失敗も含め、全て消費する。
export type DeleteAccountEvent =
  | { type: "captchaChecked"; token: string | null }
  | { type: "failed"; failure: AuthFailure };

export function deleteAccountReducer(
  flow: DeleteAccountFlow,
  event: DeleteAccountEvent,
): DeleteAccountFlow {
  switch (event.type) {
    case "captchaChecked":
      return { ...flow, captchaToken: event.token };
    // 画面のチェックのやり直しは、手続きが画面の約束で頼む。
    case "failed":
      return {
        ...flow,
        submitting: false,
        captchaToken: null,
        error: event.failure.kind,
      };
  }
}
