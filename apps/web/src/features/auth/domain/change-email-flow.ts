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

// メールアドレス変更の流れ。入力の段階とコード確認の段階、実行中の操作、確認できたコード、再送の待ち時間、
// セキュリティチェックのトークンと、操作の開始の可否と入力の検証の順序、失敗の後の状態、トークンの消費、完了の状態を守る集約。

// 認証コードの欄。currentCodeは現在のメールアドレス宛て、newCodeは新しいメールアドレス宛てのコード。
export type CodeField = "currentCode" | "newCode";

// 実行中の操作。確認は、未確認の欄をまとめて1回の操作として扱う。
type Operation = "request" | "confirm" | "resend";

export type ChangeEmailFlow = {
  readonly step: "email" | "code";
  // 現在のメールアドレス。読み取れていないときはnull。コード確認の段階では、要求の応答の値で、以後の確認と再送に使う。
  readonly currentEmail: string | null;
  // 変更先のメールアドレス。コード確認の段階だけが持つ。
  readonly newEmail: string | null;
  // 欄ごとの、認証サービスが確認できたコードの値(確認前はnull)。画面の状態だけが持ち、再送、戻る、要求しなおしで消える。
  // 誤りの値で確認しなおしても、確認できた値は残る。
  readonly confirmedCodes: { readonly [F in CodeField]: string | null };
  readonly captchaToken: string | null;
  readonly pending: Operation | null;
  // チェック未完了のまま押され、実行中の操作がトークンを待っている。
  readonly awaitingCheck: boolean;
  readonly resendCooldown: number;
  readonly fieldErrors: FieldErrors<"email" | "captcha" | "resend" | CodeField>;
  readonly error: AuthFailureKind | null;
  // 変更が完了したか。終わりの状態で、入力の段階には戻らない。
  readonly completed: boolean;
  // コード欄の世代。要求と再送の受け付けで進み、画面が、欄を作り直して値を消すために使う。
  readonly generation: number;
};

const NO_CONFIRMED_CODES = { currentCode: null, newCode: null } as const;

export const initialChangeEmailFlow: ChangeEmailFlow = {
  step: "email",
  currentEmail: null,
  newEmail: null,
  confirmedCodes: NO_CONFIRMED_CODES,
  captchaToken: null,
  pending: null,
  awaitingCheck: false,
  resendCooldown: 0,
  fieldErrors: {},
  error: null,
  completed: false,
  generation: 0,
};

type FieldErrorSet = ChangeEmailFlow["fieldErrors"];

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
  flow: ChangeEmailFlow,
  operation: Operation,
  offline: boolean,
  requiresCheck: boolean,
  check: () => Checked<Request>,
): Start<ChangeEmailFlow, Request> {
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

// 新しいメールアドレスの要求。送るのは新しいメールアドレスだけで、同じアドレスかどうかは認証サービスの応答で判定する。
export function beginRequestEmailChange(
  flow: ChangeEmailFlow,
  input: { email: string; offline: boolean },
): Start<ChangeEmailFlow, { newEmail: string }> {
  return begin(flow, "request", input.offline, false, () => {
    const email = validateEmail(input.email);
    if (email) return { ok: false, fieldErrors: { email } };
    return { ok: true, request: { newEmail: input.email } };
  });
}

// 確認の依頼の1件。欄と、その欄のメールアドレスと、入力されたコード。
export type CodeConfirmation = {
  readonly field: CodeField;
  readonly email: string;
  readonly code: string;
};

const CODE_FIELDS: readonly CodeField[] = ["currentCode", "newCode"];

// コードの確認。入力の値が確認できた値と同じ欄は呼ばず、値を変えた欄は新しい入力として、変更前、変更後の順に確認する依頼にする。
// 送信前に見るのは未入力だけで、桁数と正しさは認証サービスに任せる。どちらかの欄が未入力なら、未入力の欄ごとに示し、どの欄も確認しない。
// コードは、その欄のメールアドレス(変更前の欄は現在、変更後の欄は新しいメールアドレス)を付けて確認する。
// 確認する欄が無いとき、メールアドレスを持たない状態(コード確認の段階の前)では開始しない。
export function beginConfirmEmailChange(
  flow: ChangeEmailFlow,
  input: { codes: { readonly [F in CodeField]: string }; offline: boolean },
): Start<ChangeEmailFlow, readonly CodeConfirmation[]> {
  const { currentEmail, newEmail } = flow;
  const targets = CODE_FIELDS.filter(
    (field) => input.codes[field] !== flow.confirmedCodes[field],
  );
  if (currentEmail === null || newEmail === null || targets.length === 0) {
    return { state: flow, request: null };
  }
  const emails = { currentCode: currentEmail, newCode: newEmail };
  return begin(flow, "confirm", input.offline, false, () => {
    const missing = CODE_FIELDS.filter((field) =>
      validateAuthCode(input.codes[field]),
    );
    if (missing.length > 0) {
      return {
        ok: false,
        fieldErrors: Object.fromEntries(
          missing.map((field) => [field, "required"]),
        ),
      };
    }
    return {
      ok: true,
      request: targets.map((field) => ({
        field,
        email: emails[field],
        code: input.codes[field],
      })),
    };
  });
}

// コードの再送。待ち時間に不備が無く、オフラインでなく、セキュリティチェックが完了していれば送れる。
// 再送は、現在のメールアドレスを付けて頼む(新しいメールアドレスを付けると、認証サービスは何も送らず成功を返す)。
export function beginResendEmailChangeCode(
  flow: ChangeEmailFlow,
  input: { offline: boolean },
): Start<ChangeEmailFlow, { email: string; captchaToken: string }> {
  const { currentEmail, captchaToken } = flow;
  if (currentEmail === null) return { state: flow, request: null };
  return begin(flow, "resend", input.offline, true, () => {
    const wait = validateResendWait(flow.resendCooldown);
    if (wait) return { ok: false, fieldErrors: { resend: wait } };
    // チェック未完了のとき、トークンは使われない(beginが送らない)。
    return {
      ok: true,
      request: { email: currentEmail, captchaToken: captchaToken ?? "" },
    };
  });
}

// 画面で起きた事実。開始の命令は含まない(begin*)。
// checkWaitReleased: チェックの部品の失敗、または待ちの上限(`captcha-token.ts`)。待ちの間だけ待ちを解いてチェックのエラーを示す。
// currentEmailLoaded: 開いたときに現在のメールアドレスを読めた。
// requested: 要求が受け付けられた(応答の現在のメールアドレスと、要求した新しいメールアドレス)。
// confirmed: 確認の結果(確認できた欄とコード、誤りまたは期限切れだった欄、完了したか、コードに紐づかない最初の失敗)。
// resent: 再送が受け付けられた。failed: 要求の失敗。refused: 再送の失敗(トークンを使った)。
// backed: コード確認から入力へ戻る。
export type ChangeEmailEvent =
  | { type: "currentEmailLoaded"; email: string }
  | { type: "captchaChecked"; token: string | null }
  | CheckEvent
  | { type: "cooldownTicked" }
  | { type: "backed" }
  | { type: "requested"; currentEmail: string; newEmail: string }
  | {
      type: "confirmed";
      confirmed: readonly { field: CodeField; code: string }[];
      expired: readonly CodeField[];
      completed: boolean;
      failure: AuthFailure | null;
    }
  | { type: "resent" }
  | { type: "failed"; failure: AuthFailure }
  | { type: "refused"; failure: AuthFailure };

export function changeEmailReducer(
  flow: ChangeEmailFlow,
  event: ChangeEmailEvent,
): ChangeEmailFlow {
  switch (event.type) {
    // 読み取りは表示だけに使う。要求の応答の値が既にあるときは、古い読み取りで上書きしない。
    case "currentEmailLoaded":
      return flow.currentEmail === null
        ? { ...flow, currentEmail: event.email }
        : flow;
    case "captchaChecked":
      return applyCheckedToken(flow, event.token);
    case "checkWaitReleased":
      return applyCheckWaitReleased(flow, { pending: null });
    case "cooldownTicked":
      return { ...flow, resendCooldown: flow.resendCooldown - 1 };
    // 応答待ちに戻ると、遅れて届いた応答が別の段階へ反映されるため、操作中は戻らない。
    case "backed":
      return flow.pending !== null ? flow : backToEmail(flow);
    default:
      return settle(flow, event);
  }
}

function backToEmail(flow: ChangeEmailFlow): ChangeEmailFlow {
  return {
    ...flow,
    step: "email",
    newEmail: null,
    confirmedCodes: NO_CONFIRMED_CODES,
    captchaToken: null,
    resendCooldown: 0,
    error: null,
    fieldErrors: {},
  };
}

type Settlement = Extract<
  ChangeEmailEvent,
  {
    type: "requested" | "confirmed" | "resent" | "failed" | "refused";
  }
>;

// 操作の結果。実行中を解除し、結果を反映する。
// 実行中は`error`・`fieldErrors`が空であること(`begin`が開始で空にし、実行中に変えるのは結果だけ)を前提とし、以前のエラーはここでは消さない。
// 要求と再送の受け付けは、確認できたコードを消し、コード欄の世代を進める(欄を作り直して空にする)。要求の受け付けは、コード確認の段階にする。
// 確認の結果は、完了なら完了にする(終わりの状態)。そうでなければ確認できたコードを残し、誤りだった欄に誤りを、最初の失敗を全体に示す。
// 再送の受け付けは、両方の新しいコードが送られ前のコードが無効になるため、待ちを始める。
// セキュリティチェックのトークンは、再送の成功も失敗(refused)も使ったため消費する。
function settle(flow: ChangeEmailFlow, event: Settlement): ChangeEmailFlow {
  switch (event.type) {
    case "requested":
      return {
        ...flow,
        step: "code",
        currentEmail: event.currentEmail,
        newEmail: event.newEmail,
        confirmedCodes: NO_CONFIRMED_CODES,
        captchaToken: null,
        pending: null,
        resendCooldown: RESEND_COOLDOWN_SECONDS,
        generation: flow.generation + 1,
      };
    case "confirmed":
      return event.completed
        ? {
            ...flow,
            captchaToken: null,
            pending: null,
            resendCooldown: 0,
            completed: true,
          }
        : {
            ...flow,
            confirmedCodes: {
              ...flow.confirmedCodes,
              ...Object.fromEntries(
                event.confirmed.map(({ field, code }) => [field, code]),
              ),
            },
            pending: null,
            fieldErrors: Object.fromEntries(
              event.expired.map((field) => [field, "expiredOrInvalid"]),
            ),
            error: event.failure?.kind ?? null,
          };
    case "resent":
      return {
        ...flow,
        confirmedCodes: NO_CONFIRMED_CODES,
        captchaToken: null,
        pending: null,
        resendCooldown: RESEND_COOLDOWN_SECONDS,
        generation: flow.generation + 1,
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
