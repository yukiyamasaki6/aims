import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  lostByChange,
  lostByStatus,
  type SessionStatus,
} from "../domain/auth-change";
import {
  beginSignOut,
  endSignOut,
  initialSessionEndFlow,
  leave,
  type SignOutVerdict,
} from "../domain/session-end-flow";
import type { AuthChanges } from "./auth-changes";
import { type CallResult, failureOf } from "./call-result";
import type { ViewLifetime } from "./screen-view";

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
export type SessionAuthenticator = AuthChanges &
  SessionReader & {
    // この端末のサインインだけを終える。
    signOutHere(): Promise<CallResult>;
  };

// ページ全体を読み込んで、今の場所をサインインに置き換える遷移。履歴を残さず、前の利用者の画面の状態とクライアントのキャッシュを捨てる。
// 例外: replaceは投げることがある。手続きは扱わず、以後の遷移も行わない(稀な経路。見張りでもサインアウトでも同じ)。hereは投げない。
export type PageReplace = {
  // 今の場所(パスとクエリ)。
  here(): string;
  replace(path: string): void;
};

// busy: 実行中のため、始めなかった。
export type SignOutResult = SignOutVerdict | { readonly kind: "busy" };

type Dependencies = {
  authenticator: SessionAuthenticator;
  connectivity: Connectivity;
  pageReplace: PageReplace;
};

export type Session = {
  // サインアウトを始める。実行中の判定は集約が持ち、実行中に呼ぶとbusyを返して何もしない。終えられたら、遷移元を付けずにサインインへ移す。
  signOut(view: ViewLifetime): Promise<SignOutResult>;
  // セッションの喪失を見張り、失ったらサインインへ移す。見張りをやめる関数を返す。
  watch(): () => void;
};

// サインアウトは、この端末のサインインの終了を頼んだ後、サインインの状態を読み、未認証なら終えられたとしてサインインへ移す。
// セッションの喪失(他のタブのサインアウト、更新の拒否、確認の結果の未認証)は見張りが検知して移す。サインアウトの実行中の喪失は、サインアウトの判定に委ねる。
// 遷移の状態(SessionEndFlow)は、この手続きが1つ持ち、サインアウトと見張りの両方が使う。
export function createSession({
  authenticator,
  connectivity,
  pageReplace,
}: Dependencies): Session {
  let flow = initialSessionEndFlow;

  async function signOut(view: ViewLifetime): Promise<SignOutResult> {
    const start = beginSignOut(flow);
    flow = start.state;
    if (start.kind !== "started") return { kind: "busy" };
    const failure = failureOf(await authenticator.signOutHere());
    // 離れた後は、読まずに結果を破棄する。終了の依頼は取り消さない。
    const reading = view.isMounted() ? await authenticator.readSession() : null;
    const ended = endSignOut(
      flow,
      reading !== null && view.isMounted()
        ? { kind: "observed", status: reading.status, failure }
        : { kind: "discarded" },
    );
    flow = ended.state;
    if (ended.result.kind === "completed") {
      try {
        go(null);
      } catch {
        // 遷移が投げたときは扱わない(稀な経路)。遷移は始めた扱いのため、以後の遷移も行わない。
      }
    }
    return ended.result;
  }

  function go(from: string | null) {
    const left = leave(flow, from);
    flow = left.state;
    if (left.result !== null) pageReplace.replace(left.result);
  }

  function lose() {
    go(pageReplace.here());
  }

  // オフラインで/signinへ移ると行き止まりになるため、確認はオンラインまで保留し、戻ったら確かめる。
  function watch() {
    let disposed = false;

    async function check() {
      if (connectivity.isOffline()) return;
      const reading = await authenticator.readSession();
      if (disposed) return;
      if (lostByStatus(reading.status)) lose();
    }

    const unsubscribe = authenticator.subscribe((change) => {
      if (lostByChange(change)) lose();
    });
    const stopOnline = connectivity.onOnline(() => void check());
    void check();

    return () => {
      disposed = true;
      unsubscribe();
      stopOnline();
    };
  }

  return { signOut, watch };
}
