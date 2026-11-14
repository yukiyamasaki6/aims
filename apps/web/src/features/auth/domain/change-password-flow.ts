import type { AuthFailure, AuthFailureKind } from "./auth-failure";
import type { FieldErrors, Start } from "./flow";
import { validateNewPassword, validatePasswordPresent } from "./password";

// パスワード変更の流れ。開始の可否、入力の検証の順序、失敗の後の状態、完了の状態を守る集約。

export type ChangePasswordFlow = {
  readonly submitting: boolean;
  readonly fieldErrors: FieldErrors<"currentPassword" | "newPassword">;
  readonly error: AuthFailureKind | null;
  // 直前の送信が完了したか。次の送信の開始で消える。
  readonly completed: boolean;
  // 完了した回数。画面が、完了のたびに入力欄を作り直して値を消すために使う。
  readonly completions: number;
};

export const initialChangePasswordFlow: ChangePasswordFlow = {
  submitting: false,
  fieldErrors: {},
  error: null,
  completed: false,
  completions: 0,
};

export type PasswordChange = {
  readonly currentPassword: string;
  readonly newPassword: string;
};

// 開始の命令。判定の順序は、送信中 → 入力の判定 → オフラインの判定。
// 送信中なら開始しない。入力の不備は、現在のパスワードの未入力、新しいパスワードの未入力と文字種を全て示す。
// 長さと強さは判定せず、認証サービスの拒否に任せる。
// 入力に不備が無くオフラインなら、通信せず、オフラインを示す。
// 開始できるなら送信中にする。開始では以前のエラーと完了を消す。
// 送信中の間はエラーを持たない。
export function beginChangePassword(
  flow: ChangePasswordFlow,
  input: PasswordChange & { offline: boolean },
): Start<ChangePasswordFlow, PasswordChange> {
  if (flow.submitting) return { state: flow, request: null };
  const currentPassword = validatePasswordPresent(input.currentPassword);
  const newPassword = validateNewPassword(input.newPassword);
  if (currentPassword || newPassword) {
    return {
      state: {
        ...flow,
        error: null,
        completed: false,
        fieldErrors: {
          ...(currentPassword && { currentPassword }),
          ...(newPassword && { newPassword }),
        },
      },
      request: null,
    };
  }
  if (input.offline) {
    return {
      state: { ...flow, error: "offline", completed: false, fieldErrors: {} },
      request: null,
    };
  }
  return {
    state: {
      ...flow,
      submitting: true,
      error: null,
      completed: false,
      fieldErrors: {},
    },
    request: {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    },
  };
}

// 画面で起きた事実。開始の命令は含まない(beginChangePassword)。
// changed: 変更が受け付けられた。failed: 変更の失敗(拒否も、通信の断も)。
export type ChangePasswordEvent =
  | { type: "changed" }
  | { type: "failed"; failure: AuthFailure };

export function changePasswordReducer(
  flow: ChangePasswordFlow,
  event: ChangePasswordEvent,
): ChangePasswordFlow {
  switch (event.type) {
    case "changed":
      return {
        ...flow,
        submitting: false,
        completed: true,
        completions: flow.completions + 1,
      };
    case "failed":
      return { ...flow, submitting: false, error: event.failure.kind };
  }
}
