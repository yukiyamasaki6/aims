import { validateAuthCode } from "./auth-code";
import { type AuthFailure, failureMessage } from "./auth-failure";
import {
  CAPTCHA_INCOMPLETE_MESSAGE,
  isCaptchaCompleted,
} from "./captcha-token";
import { validateEmail } from "./email-address";
import { validateNewPassword } from "./new-password";
import { RESEND_COOLDOWN_SECONDS, validateResendWait } from "./resend-wait";

// 認証コードで本人確認をして、パスワードを設定する流れ(登録時と再設定時で同じ規則)。
// 段階、実行中の操作、再送の待ち時間、セキュリティチェックのトークンと、
// 操作の可否と入力の検証の順序、失敗の後の状態、トークンの消費を守る集約。

type Operation = "send" | "verify" | "resend" | "setPassword";

type FieldErrors = {
  readonly email?: string;
  readonly captcha?: string;
  readonly code?: string;
  readonly resend?: string;
  readonly password?: string;
};

export type PasswordSetupFlow = {
  readonly step: "email" | "code" | "password";
  readonly captchaToken: string | null;
  readonly pending: Operation | null;
  readonly resendCooldown: number;
  readonly fieldErrors: FieldErrors;
  readonly error: string | null;
};

export const initialPasswordSetupFlow: PasswordSetupFlow = {
  step: "email",
  captchaToken: null,
  pending: null,
  resendCooldown: 0,
  fieldErrors: {},
  error: null,
};

export type PasswordSetupEvent =
  | { type: "checked"; token: string | null }
  | { type: "ticked" }
  | { type: "backed" }
  | { type: "invalid"; fieldErrors: FieldErrors }
  | { type: "started"; operation: Operation }
  | { type: "codeSent" }
  | { type: "codeResent" }
  | { type: "codeConfirmed" }
  | { type: "failed"; failure: AuthFailure }
  | { type: "refused"; failure: AuthFailure };

export function passwordSetupReducer(
  flow: PasswordSetupFlow,
  event: PasswordSetupEvent,
): PasswordSetupFlow {
  switch (event.type) {
    case "checked":
      return { ...flow, captchaToken: event.token };
    case "ticked":
      return { ...flow, resendCooldown: flow.resendCooldown - 1 };
    // 確認と再送の応答待ちに戻ると、遅れて届いた応答が別の段階へ反映されるため、操作中は戻らない。
    case "backed":
      return flow.pending !== null
        ? flow
        : {
            ...flow,
            step: "email",
            captchaToken: null,
            error: null,
            fieldErrors: {},
          };
    case "invalid":
      return { ...flow, error: null, fieldErrors: event.fieldErrors };
    case "started":
      return {
        ...flow,
        pending: event.operation,
        error: null,
        fieldErrors: {},
        resendCooldown:
          event.operation === "resend"
            ? RESEND_COOLDOWN_SECONDS
            : flow.resendCooldown,
      };
    default:
      return settle(flow, event);
  }
}

type Settlement = Extract<
  PasswordSetupEvent,
  { type: "codeSent" | "codeResent" | "codeConfirmed" | "failed" | "refused" }
>;

// 操作の結果。実行中を解除し、結果を反映する。
// コードの送信と再送は、認証サービスが応答すれば(成功も、拒否も)使ったトークンを消費する。応答が無かった失敗は、使っていないので消費しない。
function settle(flow: PasswordSetupFlow, event: Settlement): PasswordSetupFlow {
  switch (event.type) {
    case "codeSent":
      return {
        ...flow,
        step: "code",
        captchaToken: null,
        pending: null,
        error: null,
        fieldErrors: {},
        resendCooldown: RESEND_COOLDOWN_SECONDS,
      };
    case "codeResent":
      return { ...flow, captchaToken: null, pending: null };
    case "codeConfirmed":
      return {
        ...flow,
        step: "password",
        pending: null,
        error: null,
        fieldErrors: {},
      };
    case "failed":
      return {
        ...flow,
        pending: null,
        error: failureMessage(event.failure),
        fieldErrors: {},
      };
    case "refused":
      return {
        ...settle(flow, { type: "failed", failure: event.failure }),
        captchaToken: null,
      };
  }
}

export type Check<Ready> =
  | { readonly kind: "busy" }
  | { readonly kind: "invalid"; readonly fieldErrors: FieldErrors }
  | ({ readonly kind: "ready" } & Ready);

const BUSY = { kind: "busy" } as const;

function invalid(fieldErrors: FieldErrors) {
  return { kind: "invalid", fieldErrors } as const;
}

// コードの送信。実行中の操作が無く、メールアドレス、セキュリティチェックの順に不備が無ければ送れる。
export function checkSendCode(
  flow: PasswordSetupFlow,
  input: { email: string },
): Check<{ email: string; captchaToken: string }> {
  if (flow.pending !== null || flow.step !== "email") return BUSY;
  const email = validateEmail(input.email);
  if (email) return invalid({ email });
  if (!isCaptchaCompleted(flow.captchaToken)) {
    return invalid({ captcha: CAPTCHA_INCOMPLETE_MESSAGE });
  }
  return { kind: "ready", email: input.email, captchaToken: flow.captchaToken };
}

export function checkVerifyCode(
  flow: PasswordSetupFlow,
  input: { email: string; code: string },
): Check<{ email: string; code: string }> {
  if (flow.pending !== null || flow.step !== "code") return BUSY;
  const code = validateAuthCode(input.code);
  if (code) return invalid({ code });
  return { kind: "ready", email: input.email, code: input.code };
}

// コードの再送。待ち時間、セキュリティチェックの順に不備が無ければ送れる。
export function checkResend(
  flow: PasswordSetupFlow,
  input: { email: string },
): Check<{ email: string; captchaToken: string }> {
  if (flow.pending !== null || flow.step !== "code") return BUSY;
  const wait = validateResendWait(flow.resendCooldown);
  if (wait) return invalid({ resend: wait });
  if (!isCaptchaCompleted(flow.captchaToken)) {
    return invalid({ resend: CAPTCHA_INCOMPLETE_MESSAGE });
  }
  return { kind: "ready", email: input.email, captchaToken: flow.captchaToken };
}

export function checkSetPassword(
  flow: PasswordSetupFlow,
  input: { password: string },
): Check<{ password: string }> {
  if (flow.pending !== null || flow.step !== "password") return BUSY;
  const password = validateNewPassword(input.password);
  if (password) return invalid({ password });
  return { kind: "ready", password: input.password };
}
