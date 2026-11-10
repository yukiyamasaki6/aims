import type { Clock } from "@/lib/clock/contract/clock";
import { lostByStatus, type SessionStatus } from "../domain/auth-change";
import type { AuthFailure } from "../domain/auth-failure";
import { signInHref } from "../domain/auth-routes";
import {
  beginSignOut,
  endSignOut,
  expireSignOut,
  initialSessionEndFlow,
  leave,
  SIGN_OUT_TIMEOUT_MS,
  type SignOutVerdict,
} from "../domain/session-end-flow";
import type { SignInChanges } from "./auth-changes";
import { type CallResult, failureOf } from "./call-result";
import type { IdentityReader } from "./identity-reader";
import type { IdentityWriter } from "./local-identity";
import type { PageReplace } from "./page-replace";

// サインインの状態の読み取り結果。認証済みのときだけ、利用者のIDを持つ。
// 分類(SessionStatus)の定義はドメインの1か所だけで、この型は分類にIDを足すだけである。
export type SessionReading = ReadingOf<SessionStatus>;

type ReadingOf<Status extends SessionStatus> = Status extends "authenticated"
  ? { readonly status: Status; readonly userId: string }
  : { readonly status: Status };

// サインインの状態を読む。保存先のセッションを確かめ、必要なら認証サービスで更新する。
// 確かめられないとき(通信失敗、接続を得られない、呼び出しが投げた)はunknownを返す。例外は投げない。
// refreshが真なら、保存先のセッションの更新を強制して確かめる(取得が認証の拒否で返ったとき)。
export type SessionReader = {
  readSession(options?: { refresh?: boolean }): Promise<SessionReading>;
};

// セッションが認証サービスに頼むこと。認証状態の変化の購読と、サインインの状態の読み取りに、この端末のサインアウトを足す。
// 例外は投げない(購読だけは、接続を得られないとき同期に投げる)。
export type SessionAuthenticator = SignInChanges &
  SessionReader & {
    // この端末のサインインだけを終える。
    signOutHere(): Promise<CallResult>;
  };

// 記録の利用者(この文書の間、変わらない)との照合。持ち主は他の機能(ラウンドの記録)で、入口が渡す。
type RecordUser = {
  isRecordUser(userId: string): boolean;
};

// サインアウトの結果。画面が区別するのは、失敗(理由を示して再試行できる)とそれ以外だけである。
// ignored: 完了(遷移で画面ごと捨てられる)、実行中のため始めなかった、のどれか。
export type SignOutResult =
  | { readonly kind: "failed"; readonly failure: AuthFailure }
  | { readonly kind: "ignored" };

type Dependencies = {
  authenticator: SessionAuthenticator;
  pageReplace: PageReplace;
  recordUser: RecordUser;
  identity: IdentityReader & IdentityWriter;
  clock: Clock;
};

export type Session = {
  // サインアウトを始める。実行中の判定は集約が持ち、実行中に呼ぶと何もしない(ignored)。終えられたら、遷移元を付けずにサインインへ移す。
  signOut(): Promise<SignOutResult>;
  // セッションの喪失と、記録の利用者と違う利用者のサインインを見張る。失ったらサインインへ、違う利用者なら今の場所へ、ページ全体を置き換える。見張りをやめる関数を返す。
  watch(): () => void;
};

function resultOf(verdict: SignOutVerdict): SignOutResult {
  return verdict.kind === "failed"
    ? { kind: "failed", failure: verdict.failure }
    : { kind: "ignored" };
}

// サインアウトは、この端末のサインインの終了を頼んだ後、サインインの状態を読み、未認証なら終えられたとしてサインインへ移す。
// 手続き全体はSIGN_OUT_TIMEOUT_MSで打ち切り、終えられなかった(通信エラー)として返す。打ち切った後の続きは、世代が違うため何も変えない(遅れて本当にサインアウトできたときは、見張りがサインインへ移す)。
// セッションの喪失(サインアウトの通知、更新の拒否、確認の結果の未認証)は見張りが検知して移す。サインアウトの実行中の喪失は、サインアウトの判定に委ねる。
// サインインの通知の利用者が記録の利用者と違うとき(起動時の復元の不一致、別の利用者のサインイン)は、新しい利用者を端末の識別情報へ書き、今の場所を読み込み直す。新しい文書は、その利用者の記録で起動する。
// 実行中の状態(SessionEndFlow)は、この手続きが1つ持ち、サインアウトと見張りの両方が使う。
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: サインアウトと見張りが1つの可変の状態(flow)を共有するファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すことになり、責務は分かれず追いにくくなる。
export function createSession({
  authenticator,
  pageReplace,
  recordUser,
  identity,
  clock,
}: Dependencies): Session {
  let flow = initialSessionEndFlow;

  // 打ち切りは、時計のコールバックの中で同期に適用する。完了と同時なら、先に決まった一方だけが効く。
  async function signOut(): Promise<SignOutResult> {
    const start = beginSignOut(flow);
    flow = start.state;
    if (start.request === null) return { kind: "ignored" };
    const mine = flow.generation;
    const { promise: expired, resolve } =
      Promise.withResolvers<SignOutResult>();
    const cancel = clock.after(SIGN_OUT_TIMEOUT_MS, () => {
      const expiry = expireSignOut(flow, mine);
      if (expiry === null) return;
      flow = expiry.state;
      resolve(resultOf(expiry.result));
    });
    try {
      return await Promise.race([finishSignOut(mine), expired]);
    } finally {
      cancel();
    }
  }

  // 世代が変わった(打ち切られた)後は、状態も遷移も変えない。
  async function finishSignOut(mine: number): Promise<SignOutResult> {
    const failure = failureOf(await authenticator.signOutHere());
    if (flow.generation !== mine) return { kind: "ignored" };
    const reading = await authenticator.readSession();
    if (flow.generation !== mine) return { kind: "ignored" };
    const ended = endSignOut(flow, { status: reading.status, failure });
    flow = ended.state;
    if (ended.result.kind === "completed") go(signInHref(null));
    return resultOf(ended.result);
  }

  function go(destination: string) {
    const target = leave(flow, destination);
    if (target !== null) pageReplace.replace(target);
  }

  function lose() {
    go(signInHref(pageReplace.here()));
  }

  // 記録の利用者と違う利用者のサインインは、今の場所を読み込み直す。
  // 先に識別情報へ書いて読み戻し、一致しないとき(保存先が使えない環境)は、読み込み直しを繰り返さないために置き換えない。
  function reloadFor(userId: string) {
    const target = leave(
      flow,
      pageReplace.here(),
      recordUser.isRecordUser(userId),
    );
    if (target === null) return;
    identity.write(userId);
    if (identity.read() !== userId) return;
    pageReplace.replace(target);
  }

  // 起動時に1回、サインインの状態を確かめる。保存先が空の起動ではサインアウトの通知が来ないため、これが要る。
  // 保存先が空の未認証は、オフラインでも移る(/offlineが出る)。
  function watch() {
    let disposed = false;

    async function check() {
      const reading = await authenticator.readSession();
      if (disposed) return;
      if (lostByStatus(reading.status)) lose();
    }

    const unsubscribe = authenticator.subscribe((change) => {
      if (change.kind === "signed-out") lose();
      else if (change.kind === "signed-in") reloadFor(change.userId);
    });
    void check();

    return () => {
      disposed = true;
      unsubscribe();
    };
  }

  return { signOut, watch };
}
