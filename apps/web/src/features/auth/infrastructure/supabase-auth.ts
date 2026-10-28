import {
  type AuthChangeEvent,
  type AuthError,
  isAuthRefreshDiscardedError,
  isAuthRetryableFetchError,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { AuthChanges } from "../application/auth-changes";
import type { CallResult } from "../application/call-result";
import type { PasswordSetupAuthenticator } from "../application/password-setup-authenticator";
import type { SignOutEverywhere } from "../application/reset-password";
import type {
  SessionAuthenticator,
  SessionReading,
} from "../application/session";
import type { SignInAuthenticator } from "../application/sign-in";
import type { AuthChange } from "../domain/auth-change";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";

// 認証サービスの語彙(エラーのクラス名とコード、イベントの名前、セッションの形)を知るのは、このファイルだけである。
// 応答を内側の形に写す変換は、この実装の中だけで使うため、同じファイルに置く。

// ブラウザから認証サービスに触る、唯一の実装。各手続きは、使う頼みごとだけの約束の型で受け取る。
// 接続は、作る関数を受け取り、頼みごとのたびに取得する(環境変数の欠落は届かない失敗になる)。ブラウザでは同じ接続が返る。
export type SupabaseAuth = SignInAuthenticator &
  PasswordSetupAuthenticator &
  SessionAuthenticator &
  SignOutEverywhere &
  AuthChanges;

type Auth = SupabaseClient["auth"];

export function createSupabaseAuth(
  getClient: () => Pick<SupabaseClient, "auth">,
): SupabaseAuth {
  const auth = () => getClient().auth;

  return {
    signIn: ({ email, password, captchaToken }) =>
      toCallResult(() =>
        auth().signInWithPassword({
          email,
          password,
          options: { captchaToken },
        }),
      ),
    sendCode: ({ purpose, email, captchaToken }) =>
      toCallResult(() =>
        purpose === "sign-up"
          ? auth().signInWithOtp({ email, options: { captchaToken } })
          : auth().resetPasswordForEmail(email, { captchaToken }),
      ),
    verifyCode: ({ purpose, email, code }) =>
      toCallResult(() =>
        auth().verifyOtp({
          email,
          token: code,
          type: purpose === "sign-up" ? "email" : "recovery",
        }),
      ),
    setPassword: (password) =>
      toCallResult(() => auth().updateUser({ password })),
    // scope!=="others"のsignOutは、サーバーへの通信が失敗してもローカルのセッションの削除は必ず行う。完了の判断は、呼び出し側が端末の識別情報で行う。
    signOutHere: () => toCallResult(() => signOut(auth(), "local")),
    // その利用者の全ての端末のサインインが終わる。
    signOutEverywhere: () => toCallResult(() => signOut(auth(), "global")),
    subscribe: (listener) => {
      const {
        data: { subscription },
      } = auth().onAuthStateChange((event, session) =>
        listener(toAuthChange(event, session)),
      );
      return () => subscription.unsubscribe();
    },
    readSession: async (options = {}) => {
      try {
        return await read(auth(), options);
      } catch {
        return { status: "unknown" };
      }
    },
  };
}

// 認証サービスのサインアウトの呼び出しは、ここだけである。localはこの端末だけ、globalはその利用者の全ての端末のセッションを無効にする。
function signOut(auth: Auth, scope: "local" | "global") {
  return auth.signOut({ scope });
}

// サインインの状態を判定する。結果の意味の判定はjudgeSessionResultが行い、ここは保存先の読み出しと更新、保存先を空にする呼び出しだけを行う。
// refreshが真なら、保存先のセッションの更新を強制して確かめる。
// 拒否の確定は、読み直しても保存先が拒否された更新トークンのまま(更新を強制した経路だけ)か、同じ拒否のオブジェクト(auth-jsが記憶した同じ更新トークンの失敗)が返ったときで、保存先を空にしてSIGNED_OUTを全体へ伝える。
// 読み直しは保存先が書き換わるたびにだけ続くため、回数や待ちの値は設けない。
async function read(
  auth: Auth,
  options: { refresh?: boolean },
): Promise<SessionReading> {
  let result: SessionResult = await auth.getSession();
  // 更新を強制したセッション。拒否の後に読み直して同じ更新トークンなら、拒否が確定している。
  let forced: Session | null = null;
  if (options.refresh && result.data.session) {
    forced = result.data.session;
    result = await auth.refreshSession({ refresh_token: forced.refresh_token });
  }
  let previous: AuthError | null = null;
  let rejected = false;
  for (;;) {
    const verdict = judgeSessionResult(result, { forced, rejected, previous });
    switch (verdict.kind) {
      case "authenticated":
        return { status: "authenticated", userId: verdict.session.user.id };
      case "clear":
        await signOut(auth, "local");
        return { status: "unauthenticated" };
      case "unauthenticated":
        return { status: "unauthenticated" };
      case "unknown":
        return { status: "unknown" };
      case "reread":
        previous = verdict.previous;
        rejected = verdict.rejected;
        result = await auth.getSession();
    }
  }
}

type RejectionKind = Exclude<
  AuthFailure["kind"],
  "other" | "unreachable" | "unauthenticated" | "already_registered"
>;

// 認証サービスが拒否したときの、エラーコードと失敗の種類の対応。
const REJECTION_KINDS = new Map<string, RejectionKind>([
  ["invalid_credentials", "invalid_credentials"],
  ["otp_expired", "code_expired"],
  ["over_email_send_rate_limit", "rate_limited"],
  ["over_request_rate_limit", "rate_limited"],
  ["captcha_failed", "captcha_failed"],
  ["weak_password", "weak_password"],
]);

type AuthServiceError = { name?: string; code?: string; message: string };

// 認証サービスのエラー(通信の断を含む)を、失敗の種類に写す。
// 通信の断はerror.codeの無いAuthRetryableFetchErrorになるため、コードより先に名前で見る。
function toAuthFailure(error: AuthServiceError): AuthFailure {
  if (error.name === "AuthRetryableFetchError") return UNREACHABLE;
  const kind =
    error.code === undefined ? undefined : REJECTION_KINDS.get(error.code);
  return kind ? { kind } : { kind: "other", message: error.message };
}

// 認証サービスの呼び出しを、例外を投げずに結果の値にする。
// 応答があって成功なら受け付けられた、エラーが値で返れば(通信の断を値で返す場合を含む)拒否された、呼び出しが投げたとき(接続を得られない場合を含む)は届かなかった、とする。
async function toCallResult(
  call: () => Promise<{ error: AuthError | null }>,
): Promise<CallResult> {
  try {
    const { error } = await call();
    return error
      ? { kind: "refused", failure: toAuthFailure(error) }
      : { kind: "accepted" };
  } catch {
    return UNREACHABLE;
  }
}

// 認証サービスのイベント名を、内側の出来事に写す。
function toAuthChange(
  event: AuthChangeEvent,
  session: Session | null,
): AuthChange {
  const userId = session?.user.id || null;
  switch (event) {
    case "SIGNED_IN":
      return { kind: "signed-in", userId };
    case "INITIAL_SESSION":
      return { kind: "initial", userId };
    case "SIGNED_OUT":
      return { kind: "signed-out" };
    default:
      return { kind: "other" };
  }
}

type SessionResult = {
  data: { session: Session | null };
  error: AuthError | null;
};

type SessionVerdict =
  | { kind: "authenticated"; session: Session }
  | { kind: "clear" }
  | { kind: "unauthenticated" }
  | { kind: "unknown" }
  | { kind: "reread"; previous: AuthError; rejected: boolean };

// セッションの取得結果の1回の判定。I/Oは行わず、保存先を空にするか(clear)、読み直すか(reread)は呼び出し側が実行する。
// 未認証を返すのは、保存先にセッションが無いとき(エラーなし)と、サーバーの拒否が確定したときだけである。
// 通信失敗はセッションが残っていて回復し得るため、不明とする。
// 更新の破棄と、別の書き手と重なった拒否は、保存先に有効なセッションが残り得るため、保存先を読み直して判定する。
function judgeSessionResult(
  result: SessionResult,
  ctx: {
    forced: Session | null;
    rejected: boolean;
    previous: AuthError | null;
  },
): SessionVerdict {
  const { session } = result.data;
  const { error } = result;
  if (session?.user) {
    if (ctx.rejected && session.refresh_token === ctx.forced?.refresh_token) {
      return { kind: "clear" };
    }
    return { kind: "authenticated", session };
  }
  if (!error) return { kind: "unauthenticated" };
  if (isAuthRetryableFetchError(error)) return { kind: "unknown" };
  let rejected = ctx.rejected;
  if (!isAuthRefreshDiscardedError(error)) {
    if (error === ctx.previous) return { kind: "clear" };
    if (ctx.forced) rejected = true;
  }
  return { kind: "reread", previous: error, rejected };
}
