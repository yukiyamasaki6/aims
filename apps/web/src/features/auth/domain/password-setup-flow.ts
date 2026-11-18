import {
  RESEND_COOLDOWN_SECONDS,
  validateAuthCode,
  validateResendWait,
} from "./auth-code";
import type { AuthFailure, AuthFailureKind } from "./auth-failure";
import {
  applyCheckedToken,
  applyCheckWaitReleased,
  type CheckEvent,
  isCaptchaCompleted,
} from "./captcha-token";
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
  // チェック未完了のまま押され、実行中の操作がトークンを待っている。
  readonly awaitingCheck: boolean;
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
  awaitingCheck: false,
  resendCooldown: 0,
  fieldErrors: {},
  error: null,
};

type FieldErrorSet = PasswordSetupFlow["fieldErrors"];

// 入力の検証の結果。不備があれば欄ごとのエラー、無ければ認証サービスへ頼む内容。
type Checked<Request> =
  | { readonly ok: false; readonly fieldErrors: FieldErrorSet }
  | { readonly ok: true; readonly request: Request };

// 開始の命令。判定の順序は、実行中(待ち以外) → 入力の判定 → オフラインの判定 → チェックの判定(チェックを要する操作だけ)。
// 実行中の操作が無いか、同じ操作がチェックを待っているときだけ開始できる。待ちの間は、トークンが無い再押下では何も変えず、トークンが届いた後の開始は通常の開始と同じに進む。
// 画面は現在の段階の操作だけを描くため、段階は検査しない。
// 入力の不備は、検査できる全てを示す。
// 入力に不備が無くオフラインなら、通信もトークンの消費もせず、オフラインを示す(チェックの状態によらず、待たない)。
// 入力に不備もオフラインも無いとき、チェックが完了なら操作を実行中にして依頼を返し、未完了(失敗の後を含む)なら依頼を返さず、操作を実行中の待ちにする。
// 開始では以前のエラーを消す(4操作で同じ)。
// 実行中の間はエラーを持たない。
function begin<Request>(
  flow: PasswordSetupFlow,
  operation: Operation,
  offline: boolean,
  requiresCheck: boolean,
  check: () => Checked<Request>,
): Start<PasswordSetupFlow, Request> {
  const waiting = requiresCheck && !isCaptchaCompleted(flow.captchaToken);
  const resuming = flow.awaitingCheck && flow.pending === operation;
  if (flow.pending !== null && (!resuming || waiting)) {
    return { state: flow, request: null };
  }
  const idle = { ...flow, pending: null, awaitingCheck: false };
  const checked = check();
  if (!checked.ok) {
    return {
      state: {
        ...idle,
        error: null,
        fieldErrors: checked.fieldErrors,
      },
      request: null,
    };
  }
  if (offline) {
    return {
      state: { ...idle, error: "offline", fieldErrors: {} },
      request: null,
    };
  }
  const running = { ...idle, error: null, fieldErrors: {}, pending: operation };
  return waiting
    ? { state: { ...running, awaitingCheck: true }, request: null }
    : { state: running, request: checked.request };
}

// コードの送付(初回も再送も)。メールアドレスと再送の待ち時間に不備が無く、オフラインでなく、セキュリティチェックが完了していれば送れる。
// 待ちは、コード入力の段階で残りがあるときの不備である(メール入力の段階では0)。
export function beginSendCode(
  flow: PasswordSetupFlow,
  input: { email: string; offline: boolean },
): Start<PasswordSetupFlow, { email: string; captchaToken: string }> {
  return begin(flow, "send", input.offline, true, () => {
    const email = validateEmail(input.email);
    const wait = validateResendWait(flow.resendCooldown);
    if (email || wait) {
      return {
        ok: false,
        fieldErrors: { ...(email && { email }), ...(wait && { resend: wait }) },
      };
    }
    // チェック未完了のとき、この値は使われない(beginが送らない)。
    return {
      ok: true,
      request: { email: input.email, captchaToken: flow.captchaToken ?? "" },
    };
  });
}

// コードの確認。送信前に見るのは未入力だけで、桁数と正しさは認証サービスに任せる。
export function beginVerifyCode(
  flow: PasswordSetupFlow,
  input: { email: string; code: string; offline: boolean },
): Start<PasswordSetupFlow, { email: string; code: string }> {
  return begin(flow, "verify", input.offline, false, () => {
    const code = validateAuthCode(input.code);
    if (code) return { ok: false, fieldErrors: { code } };
    return { ok: true, request: { email: input.email, code: input.code } };
  });
}

// パスワードの設定の依頼の内容。captchaTokenは、チェックを要する手続き(requiresCheck)だけが持つ。
export type SetPasswordRequest = {
  password: string;
  captchaToken: string | null;
};

// パスワードの設定。判定の順序は、入力 → オフライン → チェック。
// requiresCheckが真(サインアップ)のときだけ、チェックの判定を行い、トークンを依頼に含める。
export function beginSetPassword(
  flow: PasswordSetupFlow,
  input: { password: string; offline: boolean; requiresCheck: boolean },
): Start<PasswordSetupFlow, SetPasswordRequest> {
  return begin(flow, "setPassword", input.offline, input.requiresCheck, () => {
    const password = validateNewPassword(input.password);
    if (password) return { ok: false, fieldErrors: { password } };
    return {
      ok: true,
      request: {
        password: input.password,
        captchaToken: input.requiresCheck ? flow.captchaToken : null,
      },
    };
  });
}

// 画面で起きた事実。開始の命令は含まない(begin*)。
// checkWaitReleased: チェックの部品の失敗、または待ちの上限(`captcha-token.ts`)。待ちの間だけ待ちを解いてチェックのエラーを示す。
export type PasswordSetupEvent =
  | { type: "captchaChecked"; token: string | null }
  | CheckEvent
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
      return applyCheckedToken(flow, event.token);
    case "checkWaitReleased":
      return applyCheckWaitReleased(flow, { pending: null });
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
// セキュリティチェックのトークンは、コードの送付の成功(codeSent)も失敗(refused)も使ったため消費する。
// 確認の成功(codeConfirmed)は、コード入力の段階のトークンを持ち越さないため消す(パスワード設定の段階のウィジェットが取り直す)。
// パスワードの設定の失敗(failed)はトークンを使わない。サインアップの設定の後のサインインの失敗は、使ったため消費する(refused)。
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
        captchaToken: null,
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
