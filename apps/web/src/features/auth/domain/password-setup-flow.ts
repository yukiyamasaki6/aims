import {
  RESEND_COOLDOWN_SECONDS,
  validateAuthCode,
  validateResendWait,
} from "./auth-code";
import type { AuthFailure, AuthFailureKind } from "./auth-failure";
import { isCaptchaCompleted } from "./captcha-token";
import { validateEmail } from "./email-address";
import type { FieldErrors, Start } from "./flow";
import { validateNewPassword } from "./password";

// 認証コードで本人確認をして、パスワードを設定する流れ(登録時と再設定時で同じ規則)。
// 段階、実行中の操作、再送の待ち時間、セキュリティチェックのトークンと、
// 操作の開始の可否と入力の検証の順序、失敗の後の状態、トークンの消費を守る集約。

type Operation = "send" | "verify" | "setPassword";

export type PasswordSetupFlow = {
  readonly step: "email" | "code" | "password";
  readonly captchaToken: string | null;
  readonly pending: Operation | null;
  readonly resendCooldown: number;
  readonly fieldErrors: FieldErrors<
    "email" | "captcha" | "resend" | "password" | "code"
  >;
  readonly error: AuthFailureKind | null;
};

export const initialPasswordSetupFlow: PasswordSetupFlow = {
  step: "email",
  captchaToken: null,
  pending: null,
  resendCooldown: 0,
  fieldErrors: {},
  error: null,
};

type FieldErrorSet = PasswordSetupFlow["fieldErrors"];

// 入力の検証の結果。不備があれば欄ごとのエラー、無ければ認証サービスへ頼む内容。
type Checked<Request> =
  | { readonly ok: false; readonly fieldErrors: FieldErrorSet }
  | { readonly ok: true; readonly request: Request };

// 開始の命令。判定の順序は、実行中 → 入力の判定 → オフラインの判定(→ 送付ではチェックの判定を入力の判定に含める)。
// 実行中の操作が無いときだけ開始できる(busy)。画面は現在の段階の操作だけを描くため、段階は検査しない。
// 入力の不備は、検査できる全てを示す(invalid)。入力に不備が無くオフラインなら、通信もトークンの消費もせず、オフラインを示す(offline)。
// 開始できるなら、その操作を実行中にする(started)。
// 開始では以前のエラーを消す(4操作で同じ)。
// 実行中の間はエラーを持たない。
function begin<Request>(
  flow: PasswordSetupFlow,
  operation: Operation,
  offline: boolean,
  check: () => Checked<Request>,
): Start<PasswordSetupFlow, Request> {
  if (flow.pending !== null) {
    return { state: flow, request: null };
  }
  const checked = check();
  if (!checked.ok) {
    return {
      state: { ...flow, error: null, fieldErrors: checked.fieldErrors },
      request: null,
    };
  }
  if (offline) {
    return {
      state: { ...flow, error: "offline", fieldErrors: {} },
      request: null,
    };
  }
  return {
    state: {
      ...flow,
      error: null,
      fieldErrors: {},
      pending: operation,
    },
    request: checked.request,
  };
}

// コードの送付(初回も再送も)。メールアドレス、再送の待ち時間、セキュリティチェックの全てに不備が無く、オフラインでなければ送れる。
// 待ちは、コード入力の段階で残りがあるときの不備である(メール入力の段階では0)。
// チェック未完了は、オンラインのときだけ不備にする(オフラインでは原因を取り違えるため示さない)。
export function beginSendCode(
  flow: PasswordSetupFlow,
  input: { email: string; offline: boolean },
): Start<PasswordSetupFlow, { email: string; captchaToken: string }> {
  return begin(flow, "send", input.offline, () => {
    const email = validateEmail(input.email);
    const wait = validateResendWait(flow.resendCooldown);
    const { captchaToken } = flow;
    const captchaMissing = !input.offline && !isCaptchaCompleted(captchaToken);
    if (email || wait || captchaMissing) {
      return {
        ok: false,
        fieldErrors: {
          ...(email && { email }),
          ...(wait && { resend: wait }),
          ...(captchaMissing && { captcha: "incomplete" }),
        },
      };
    }
    // オフラインのときは、この値は使われない(beginが送らない)。
    return {
      ok: true,
      request: { email: input.email, captchaToken: captchaToken ?? "" },
    };
  });
}

// コードの確認。送信前に見るのは未入力だけで、桁数と正しさは認証サービスに任せる。
export function beginVerifyCode(
  flow: PasswordSetupFlow,
  input: { email: string; code: string; offline: boolean },
): Start<PasswordSetupFlow, { email: string; code: string }> {
  return begin(flow, "verify", input.offline, () => {
    const code = validateAuthCode(input.code);
    if (code) return { ok: false, fieldErrors: { code } };
    return { ok: true, request: { email: input.email, code: input.code } };
  });
}

export function beginSetPassword(
  flow: PasswordSetupFlow,
  input: { password: string; offline: boolean },
): Start<PasswordSetupFlow, { password: string }> {
  return begin(flow, "setPassword", input.offline, () => {
    const password = validateNewPassword(input.password);
    if (password) return { ok: false, fieldErrors: { password } };
    return { ok: true, request: { password: input.password } };
  });
}

// 画面で起きた事実。開始の命令は含まない(begin*)。
export type PasswordSetupEvent =
  | { type: "captchaChecked"; token: string | null }
  | { type: "cooldownTicked" }
  | { type: "emailStepReturned" }
  | { type: "codeSent" }
  | { type: "codeConfirmed" }
  | { type: "failed"; failure: AuthFailure }
  | { type: "refused"; failure: AuthFailure };

export function passwordSetupReducer(
  flow: PasswordSetupFlow,
  event: PasswordSetupEvent,
): PasswordSetupFlow {
  switch (event.type) {
    case "captchaChecked":
      return { ...flow, captchaToken: event.token };
    case "cooldownTicked":
      return { ...flow, resendCooldown: flow.resendCooldown - 1 };
    // 確認と送付の応答待ちに戻ると、遅れて届いた応答が別の段階へ反映されるため、操作中は戻らない。
    case "emailStepReturned":
      return flow.pending !== null
        ? flow
        : {
            ...flow,
            step: "email",
            captchaToken: null,
            resendCooldown: 0,
            error: null,
            fieldErrors: {},
          };
    default:
      return settle(flow, event);
  }
}

type Settlement = Extract<
  PasswordSetupEvent,
  { type: "codeSent" | "codeConfirmed" | "failed" | "refused" }
>;

// 操作の結果。実行中を解除し、結果を反映する。
// 失敗は理由に差し替える。
// 実行中は`error`・`fieldErrors`が空であること(`begin`が開始で空にし、実行中に変えるのは結果だけ)を前提とし、以前のエラーはここでは消さない。
// セキュリティチェックのトークンは、コードの送付の成功(codeSent)も失敗(refused)も使ったため消費する。確認とパスワードの設定の失敗(failed)はトークンを使わない。
function settle(flow: PasswordSetupFlow, event: Settlement): PasswordSetupFlow {
  switch (event.type) {
    case "codeSent":
      return {
        ...flow,
        step: "code",
        captchaToken: null,
        pending: null,
        resendCooldown: RESEND_COOLDOWN_SECONDS,
      };
    case "codeConfirmed":
      return {
        ...flow,
        step: "password",
        pending: null,
      };
    case "failed":
      return {
        ...flow,
        pending: null,
        error: event.failure.kind,
      };
    case "refused":
      return {
        ...settle(flow, { type: "failed", failure: event.failure }),
        captchaToken: null,
      };
  }
}
