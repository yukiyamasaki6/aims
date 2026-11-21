import {
  type AuthChangeEvent,
  type AuthError,
  isAuthRefreshDiscardedError,
  isAuthRetryableFetchError,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import type { SignInChange, SignInChanges } from "../application/auth-changes";
import type { CallResult } from "../application/call-result";
import type {
  ChangeEmailAuthenticator,
  EmailChangeConfirmResult,
  EmailChangeRequestResult,
} from "../application/change-email";
import type {
  CurrentAccountResult,
  DeleteAccountAuthenticator,
} from "../application/delete-account";
import type {
  CodeVerification,
  EmailOtpAuthenticator,
} from "../application/email-otp";
import type { GoogleSignInAuthenticator } from "../application/google-sign-in";
import type {
  AccountReading,
  LinkGoogleAuthenticator,
} from "../application/link-google";
import type {
  SessionAuthenticator,
  SessionReading,
} from "../application/session";
import {
  type AccountSummary,
  googleIdentityOf,
} from "../domain/account-summary";
import { type AuthFailure, UNREACHABLE } from "../domain/auth-failure";

// 認証サービスの語彙(エラーのクラス名とコード、イベントの名前、セッションの形)を知るのは、このファイルだけである。
// 応答を内側の形に写す変換は、この実装の中だけで使うため、同じファイルに置く。

// 利用者のセッションで認証サービスに触る、唯一の実装。入口がブラウザの接続を渡す。各手続きは、使う頼みごとだけの約束の型で受け取る。
// 接続は、作る関数を受け取り、頼みごとのたびに取得する(環境変数の欠落は届かない失敗になる)。ブラウザでは同じ接続が返る。
export type SupabaseAuth = EmailOtpAuthenticator &
  ChangeEmailAuthenticator &
  DeleteAccountAuthenticator &
  SessionAuthenticator &
  GoogleSignInAuthenticator &
  LinkGoogleAuthenticator &
  SignInChanges;

type Auth = SupabaseClient["auth"];

export function createSupabaseAuth(
  getClient: () => Pick<SupabaseClient, "auth">,
): SupabaseAuth {
  const auth = () => getClient().auth;

  return {
    sendCode: ({ email, captchaToken, shouldCreateUser }) =>
      sendEmailCode(auth, { email, captchaToken, shouldCreateUser }),
    verifyCode: ({ email, code }) => verifyEmailCode(auth, email, code),
    readCurrentAccount: () => readCurrentAccount(auth),
    ...createGoogleAuthenticator(auth),
    ...createChangeEmailAuthenticator(auth),
    // この端末のサインインだけを終える。終えられたかは、呼び出し側が、この後のサインインの状態の読み取りで決める。
    signOutHere: () => revokeAndClear(auth),
    discardHere: () => toCallResult(() => signOut(auth(), "local")),
    subscribe: (listener) => {
      const {
        data: { subscription },
      } = auth().onAuthStateChange((event, session) => {
        const change = toSignInChange(event, session);
        if (change !== null) listener(change);
      });
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

// この端末のセッションだけを終了する。
function signOut(auth: Auth, scope: "local") {
  return auth.signOut({ scope });
}

// セッションが既に無いことを表す、失効の呼び出しの拒否の状態コード。
const GONE_STATUSES = new Set([401, 403, 404]);

// この端末のセッションの失効を認証サービスに頼み、受け付けられたときだけ保存先のセッションを削除する。
// SDKのsignOutは、通信失敗など(401・403・404以外)でも保存先を削除するため、失効の頼み(admin.signOut)と保存先の削除を分ける。
// 失効が受け付けられなかった(届かない、5xx、429など)ときと、保存先のセッションを取得できないときは、保存先に触らず失敗を返す。
// 保存先にセッションが無いときは、保存先を整理して受け付けとする。
async function revokeAndClear(auth: () => Auth): Promise<CallResult> {
  try {
    const { data, error } = await auth().getSession();
    if (error) return failedResult(error);
    if (!data.session) return await clearLocal(auth);
    const revoked = await auth().admin.signOut(
      data.session.access_token,
      "local",
    );
    if (revoked.error && !GONE_STATUSES.has(revoked.error.status ?? 0)) {
      return failedResult(revoked.error);
    }
    return await clearLocal(auth);
  } catch {
    return { kind: "failed", failure: UNREACHABLE };
  }
}

function failedResult(error: AuthError): CallResult {
  return { kind: "failed", failure: toAuthFailure(error, REJECTION_KINDS) };
}

// 失効の済んだ(またはセッションの無い)保存先を削除して通知を出す。ここでのエラーは無視する(失効済みのため。終えられたかは後続の読み取りが判定する)。
async function clearLocal(auth: () => Auth): Promise<CallResult> {
  await signOut(auth(), "local");
  return { kind: "accepted" };
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

// offlineと、googleで始まる種類は、集約・手続きが作る種類(google_only_addressは、統合入口の送付だけが写す)で、共通の対応には入れない。
type RejectionKind = Exclude<
  AuthFailure["kind"],
  | "other"
  | "unreachable"
  | "offline"
  | "google_cancelled"
  | "google_only_address"
  | "google_link_cancelled"
  | "google_link_taken"
>;

// 認証サービスが拒否したときの、エラーコードと失敗の種類の対応。
const REJECTION_KINDS = new Map<string, RejectionKind>([
  ["otp_expired", "code_expired"],
  ["over_email_send_rate_limit", "rate_limited"],
  ["over_request_rate_limit", "rate_limited"],
  ["captcha_failed", "captcha_failed"],
]);

// メールアドレスの変更だけが使う対応。他の操作の対応に、他の利用者と重複するメールアドレスの拒否を足す。
// 確認の誤りも期限切れも、otp_expiredで返る。
const CHANGE_EMAIL_REJECTION_KINDS = new Map<string, RejectionKind>([
  ...REJECTION_KINDS,
  ["email_exists", "email_exists"],
]);

type AuthServiceError = { name?: string; code?: string };

// 認証サービスのエラー(通信の断を含む)を、失敗の種類に写す。
// 通信の断はerror.codeの無いAuthRetryableFetchErrorになるため、コードより先に名前で見る。
function toAuthFailure(
  error: AuthServiceError,
  kinds: ReadonlyMap<string, RejectionKind>,
): AuthFailure {
  if (error.name === "AuthRetryableFetchError") return UNREACHABLE;
  const kind = error.code === undefined ? undefined : kinds.get(error.code);
  return { kind: kind ?? "other" };
}

// 認証サービスの呼び出しを、例外を投げずに結果の値にする。
// 応答があって成功なら受け付けられた、エラーが値で返れば(通信の断を値で返す場合を含む)その失敗、呼び出しが投げたとき(接続を得られない場合を含む)は届かなかった失敗、とする。
async function toCallResult(
  call: () => Promise<{ error: AuthError | null }>,
  kinds: ReadonlyMap<string, RejectionKind> = REJECTION_KINDS,
): Promise<CallResult> {
  try {
    const { error } = await call();
    return error
      ? { kind: "failed", failure: toAuthFailure(error, kinds) }
      : { kind: "accepted" };
  } catch {
    return { kind: "failed", failure: UNREACHABLE };
  }
}

async function sendEmailCode(
  auth: () => Auth,
  request: { email: string; captchaToken: string; shouldCreateUser: boolean },
): Promise<CallResult> {
  try {
    const { email, ...options } = request;
    const { error } = await auth().signInWithOtp({ email, options });
    if (!error || (!options.shouldCreateUser && error.code === "otp_disabled"))
      return { kind: "accepted" };
    // 登録を許す送付(サインインの統合入口)で、Googleの手段にだけ残るアドレスは、認証サービスが422 `user_already_exists`を返す。
    // 削除の再確認(shouldCreateUser: false)とメール変更には足さない。
    if (options.shouldCreateUser && error.code === "user_already_exists") {
      return { kind: "failed", failure: { kind: "google_only_address" } };
    }
    return { kind: "failed", failure: toAuthFailure(error, REJECTION_KINDS) };
  } catch {
    return { kind: "failed", failure: UNREACHABLE };
  }
}

async function verifyEmailCode(
  auth: () => Auth,
  email: string,
  code: string,
): Promise<CodeVerification> {
  try {
    const { data, error } = await auth().verifyOtp({
      email,
      token: code,
      type: "email",
    });
    if (error)
      return { kind: "failed", failure: toAuthFailure(error, REJECTION_KINDS) };
    return data.session && data.user
      ? { kind: "verified" }
      : { kind: "failed", failure: { kind: "other" } };
  } catch {
    return { kind: "failed", failure: UNREACHABLE };
  }
}

async function readCurrentAccount(
  auth: () => Auth,
): Promise<CurrentAccountResult> {
  try {
    const { data, error } = await auth().getUser();
    if (error)
      return error.status === 401 || error.status === 403
        ? { kind: "lost" }
        : { kind: "failed", failure: toAuthFailure(error, REJECTION_KINDS) };
    return data.user?.email
      ? { kind: "current", userId: data.user.id, email: data.user.email }
      : { kind: "failed", failure: { kind: "other" } };
  } catch {
    return { kind: "failed", failure: UNREACHABLE };
  }
}

// Googleでのサインイン(`/signin`)と、Googleアカウントの追加・削除の認証サービスへの頼みごと。
function createGoogleAuthenticator(
  auth: () => Auth,
): GoogleSignInAuthenticator & LinkGoogleAuthenticator {
  return {
    // 戻り先は今のオリジンに足す。成功ではSDKがGoogleの画面へ移す。失敗は値で返す(検証子を保存できないなど)。
    startGoogleSignIn: ({ returnPath }) =>
      toCallResult(() =>
        auth().signInWithOAuth({
          provider: "google",
          options: { redirectTo: redirectToOf(returnPath) },
        }),
      ),
    exchangeGoogleCode: (code) =>
      toCallResult(() => auth().exchangeCodeForSession(code)),
    startGoogleLink: ({ returnPath }) =>
      toCallResult(() =>
        auth().linkIdentity({
          provider: "google",
          options: { redirectTo: redirectToOf(returnPath) },
        }),
      ),
    readAccount: () => readAccount(auth),
    unlinkGoogle: (identityId) => unlinkGoogle(auth, identityId),
  };
}

// 今のオリジンからの戻り先のURL。
function redirectToOf(path: string): string {
  return `${window.location.origin}${path}`;
}

// 認証サービスの利用者から、アカウントの概要を作る。identitiesを読めないときはnull。
function summaryOf(user: User): AccountSummary | null {
  const { identities } = user;
  if (!identities) return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    google: googleIdentityOf(
      identities.map((identity) => ({
        id: identity.identity_id,
        provider: identity.provider,
        email:
          typeof identity.identity_data?.email === "string"
            ? identity.identity_data.email
            : null,
        createdAt: identity.created_at ?? null,
      })),
    ),
  };
}

// 現在の利用者を認証サービスで読み直す(401・403の拒否はサインインの喪失)。
async function readAccount(auth: () => Auth): Promise<AccountReading> {
  try {
    const { data, error } = await auth().getUser();
    if (error) {
      return error.status === 401 || error.status === 403
        ? { kind: "lost" }
        : { kind: "failed", failure: toAuthFailure(error, REJECTION_KINDS) };
    }
    const account = summaryOf(data.user);
    return account
      ? { kind: "read", account }
      : { kind: "failed", failure: { kind: "other" } };
  } catch {
    return { kind: "failed", failure: UNREACHABLE };
  }
}

// Googleの手段を、手段の一覧から探して解除する。見つからないときは、既に解除されているものとして受け付ける。
async function unlinkGoogle(
  auth: () => Auth,
  identityId: string,
): Promise<CallResult> {
  try {
    const { data, error } = await auth().getUserIdentities();
    if (error) return failedResult(error);
    const identity = data.identities.find((i) => i.identity_id === identityId);
    if (!identity) return { kind: "accepted" };
    const unlinked = await auth().unlinkIdentity(identity);
    return unlinked.error ? failedResult(unlinked.error) : { kind: "accepted" };
  } catch {
    return { kind: "failed", failure: UNREACHABLE };
  }
}

function createChangeEmailAuthenticator(
  auth: () => Auth,
): ChangeEmailAuthenticator {
  return {
    // 現在のメールアドレスは表示だけに使う。読めない(トークンが切れて更新できないなど)ときはnull。
    readCurrentEmail: async () => {
      try {
        const { data } = await auth().getSession();
        return data.session?.user.email ?? null;
      } catch {
        return null;
      }
    },
    requestEmailChange: ({ newEmail }) => requestEmailChange(auth, newEmail),
    confirmEmailChange: ({ email, code }) =>
      confirmEmailChange(auth, email, code),
    // emailは現在のメールアドレスにする。新しいメールアドレスを渡すと、認証サービスは何も送らず成功を返す。
    resendEmailChangeCode: ({ email, captchaToken }) =>
      toCallResult(
        () =>
          auth().resend({
            type: "email_change",
            email,
            options: { captchaToken },
          }),
        CHANGE_EMAIL_REJECTION_KINDS,
      ),
  };
}

// 変更の要求。接続の取得もtryの中で行い、得られないときは届かなかった失敗にする。応答の現在のメールアドレスが要求と同じなら(大文字小文字を無視)、同じメールアドレスの要求である。
// 認証サービスは同じメールアドレスの要求に成功を返すが、メールを送らないため、受け付けとしない。
async function requestEmailChange(
  auth: () => Auth,
  newEmail: string,
): Promise<EmailChangeRequestResult> {
  try {
    const { data, error } = await auth().updateUser({ email: newEmail });
    if (error) {
      return {
        kind: "failed",
        failure: toAuthFailure(error, CHANGE_EMAIL_REJECTION_KINDS),
      };
    }
    const currentEmail = data.user.email;
    if (currentEmail === undefined) {
      return { kind: "failed", failure: { kind: "other" } };
    }
    if (currentEmail.toLowerCase() === newEmail.toLowerCase()) {
      return { kind: "failed", failure: { kind: "same_email" } };
    }
    return { kind: "accepted", currentEmail };
  } catch {
    return { kind: "failed", failure: UNREACHABLE };
  }
}

// 変更のコードの確認。一方だけの確認は利用者もセッションも返さず、両方が済むとセッションを返す。
// 応答のセッションはSDKが採用する。
async function confirmEmailChange(
  auth: () => Auth,
  email: string,
  code: string,
): Promise<EmailChangeConfirmResult> {
  try {
    const { data, error } = await auth().verifyOtp({
      email,
      token: code,
      type: "email_change",
    });
    if (error) {
      return {
        kind: "failed",
        failure: toAuthFailure(error, CHANGE_EMAIL_REJECTION_KINDS),
      };
    }
    return { kind: data.session === null ? "partial" : "completed" };
  } catch {
    return { kind: "failed", failure: UNREACHABLE };
  }
}

// 認証サービスのイベント名を、内側の出来事に写す。通知しない出来事はnull。
// SIGNED_IN、利用者のいる起動時のセッションの復元は、signed-in。SIGNED_OUTはsigned-out。
// 利用者のいない起動時と、その他の出来事(TOKEN_REFRESHED、PASSWORD_RECOVERY、USER_UPDATEDなど)は通知しない。
// 利用者のいない起動時は、未サインインではなく確かめられなかっただけの可能性があるため、記録を消さない。
function toSignInChange(
  event: AuthChangeEvent,
  session: Session | null,
): SignInChange | null {
  switch (event) {
    case "SIGNED_IN":
    case "INITIAL_SESSION": {
      const user = session?.user;
      return user
        ? { kind: "signed-in", userId: user.id, summary: summaryOf(user) }
        : null;
    }
    case "SIGNED_OUT":
      return { kind: "signed-out" };
    default:
      return null;
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
