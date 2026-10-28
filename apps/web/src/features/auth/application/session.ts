import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import type { AuthFailure } from "../domain/auth-failure";
import {
  beginSignOut,
  endSignOut,
  initialSessionEnd,
  leave,
  type SignOutVerdict,
} from "../domain/session-end";
import {
  lostByEvent,
  lostByStatus,
  type SessionStatus,
} from "../domain/session-event";
import type { AuthEvents } from "./auth-events";
import type { ScreenView } from "./screen-view";

// セッションが認証サービスに頼むこと。例外は投げず、値で返す。
export type SessionAuthority = AuthEvents & {
  // この端末のサインインだけを終える。応答があって拒否されたときはその失敗、呼び出しが投げたときは届かなかった失敗、問題が無ければnullを返す。
  signOutHere(): Promise<AuthFailure | null>;
  // 保存先と認証サービスで、サインインの状態を確かめる。確かめられないときはunknownを返す。
  check(): Promise<SessionStatus>;
};

// 端末の識別情報の読み出し。この端末に最後にサインインした利用者(いなければnull)。例外は投げない。
export type IdentityReader = {
  read(): string | null;
};

// ページ全体を読み込んで、今の場所をサインインに置き換える遷移。履歴を残さず、前の利用者の画面の状態とクライアントのキャッシュを捨てる。
export type PageReplace = {
  // 今の場所(パスとクエリ)。
  here(): string;
  replace(path: string): void;
};

// サインアウトが画面に頼むこと。画面が表示中かだけである(画面の状態は持たない)。
type SignOutView = Pick<ScreenView<unknown, unknown>, "isMounted">;

// discarded: 完了を待つ間に画面が離れたため、結果を破棄した。
export type SignOutResult = SignOutVerdict | { readonly kind: "discarded" };

type Dependencies = {
  authority: SessionAuthority;
  identity: IdentityReader;
  connectivity: Connectivity;
  page: PageReplace;
};

export type Session = {
  signOut(view: SignOutView): Promise<SignOutResult>;
  // セッションの喪失を見張り、失ったらサインインへ移す。見張りをやめる関数を返す。
  watch(): () => void;
};

// 遷移はセッション喪失の検知の1経路に集める。サインアウトは遷移せず、始める前に遷移元を付けない合図を立て、
// 完了したら、認証状態の変化(signed-out)を受けた検知が、その合図に従ってサインインへ移す。
// 合図と遷移の状態(SessionEnd)は、この手続きが1つ持ち、サインアウトと見張りの両方が使う。
export function createSession({
  authority,
  identity,
  connectivity,
  page,
}: Dependencies): Session {
  let end = initialSessionEnd;

  async function signOut(view: SignOutView): Promise<SignOutResult> {
    end = beginSignOut(end);
    const failure = await authority.signOutHere();
    // 離れた後は、結果を破棄し、状態を更新しない(合図も解除しない)。
    if (!view.isMounted()) return { kind: "discarded" };
    const ended = endSignOut(end, { identity: identity.read(), failure });
    end = ended.state;
    return ended.verdict;
  }

  function lose() {
    const left = leave(end, page.here());
    end = left.state;
    if (left.destination !== null) page.replace(left.destination);
  }

  // オフラインで/signinへ移ると行き止まりになるため、確認はオンラインまで保留し、戻ったら確かめる。
  function watch() {
    let disposed = false;

    async function check() {
      if (connectivity.isOffline()) return;
      const status = await authority.check();
      if (disposed) return;
      if (lostByStatus(status)) lose();
    }

    const unsubscribe = authority.subscribe((event) => {
      if (lostByEvent(event)) lose();
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
