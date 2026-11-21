import type { Connectivity } from "@/lib/connectivity/contract/connectivity";
import {
  LINK_GOOGLE_PARAM,
  LINK_GOOGLE_VALUE,
  ROUNDS_PATH,
  SETTINGS_ACCOUNT_HASH,
} from "@/routes";
import type { AccountSummary } from "../domain/account-summary";
import type { AuthFailure } from "../domain/auth-failure";
import { type GoogleReturn, linkGoogleReturnOf } from "../domain/google-return";
import {
  beginAddGoogle,
  beginGoogleLinkReturn,
  beginRemoveGoogle,
  type LinkGoogleEvent,
  type LinkGoogleFlow,
} from "../domain/link-google-flow";
import type { AccountSummaryStore } from "./account-summary-store";
import { type CallResult, failureOf } from "./call-result";
import type { ScreenView } from "./screen-view";

// アカウントの概要の読み直しの結果。lost: 認証サービスが現在の利用者を拒否した(サインインを失った)。
export type AccountReading =
  | { readonly kind: "read"; readonly account: AccountSummary }
  | { readonly kind: "failed"; readonly failure: AuthFailure }
  | { readonly kind: "lost" };

// 認証サービスにGoogleアカウントの追加・解除を頼む。例外は投げず、結果は値で返す。
// startGoogleLink: Googleの画面へ移す(移った後は結果を受け取らない)。returnPathは今のオリジンからの戻り先。
// readAccount: 現在の利用者を認証サービスから読み直す。unlinkGoogle: Googleの手段(identityId)を解除する。
export type LinkGoogleAuthenticator = {
  startGoogleLink(request: { returnPath: string }): Promise<CallResult>;
  readAccount(): Promise<AccountReading>;
  unlinkGoogle(identityId: string): Promise<CallResult>;
};

// Googleの解除の前に、メールの手段が無ければ作る。例外は投げず、結果は値で返す。
export type EmailIdentityPreparation = {
  ensure(): Promise<CallResult>;
};

type LinkGoogleView = ScreenView<LinkGoogleFlow, LinkGoogleEvent>;

export type LinkGoogle = {
  // 記録のアカウントの概要(行の初期表示)。無いときはnull。
  stored(): AccountSummary | null;
  // 「追加」の押下。オフラインなら示して留まり、そうでなければGoogleの画面へ移す。
  start(view: LinkGoogleView): Promise<void>;
  // 画面の読み込み後に1回、今のクエリを渡す。追加の戻りなら、文書の中に1件だけ預かって真を返す(入口が、戻りを外して設定パネルを開く)。
  capture(search: string): boolean;
  // 行の部品のマウント時に呼ぶ。預かった戻りがあれば処理する。無ければ、オンラインのとき読み直す。
  resume(view: LinkGoogleView): Promise<void>;
  // 解除の確認の後。メールの手段を確かめてから、Googleの手段を解除する。
  remove(input: { identityId: string }, view: LinkGoogleView): Promise<void>;
};

type Dependencies = {
  authenticator: LinkGoogleAuthenticator;
  emailIdentity: EmailIdentityPreparation;
  summaries: AccountSummaryStore;
  connectivity: Pick<Connectivity, "isOffline">;
};

// 追加の戻り先。成功の戻りではハッシュが保たれ、失敗の戻りでは認証サービスが置き換える(入口が分類「アカウント」を開き直す)。背景の画面はホームに固定する。
const RETURN_PATH = `${ROUNDS_PATH}?${LINK_GOOGLE_PARAM}=${LINK_GOOGLE_VALUE}${SETTINGS_ACCOUNT_HASH}`;

// 追加の失敗と、解除の失敗。認証サービスの理由によらず、同じ種類で示す。
const AUTH_FAILED: AuthFailure = { kind: "google_auth_failed" };
const UNLINK_FAILED: AuthFailure = { kind: "google_unlink_failed" };

// 記録の概要からGoogleの手段を外し、記録も更新して返す。記録が無いときはnull(行は変わらない)。
function withoutGoogle(summaries: AccountSummaryStore): AccountSummary | null {
  const recorded = summaries.read();
  if (recorded === null) return null;
  const account = { ...recorded, google: null };
  summaries.write(account);
  return account;
}

// 戻りの失敗。取り消し・拒否は、何も示さない(失敗の種類も作らない)。
function returnFailureOf(googleReturn: GoogleReturn): AuthFailure | null {
  switch (googleReturn.kind) {
    case "cancelled":
      return null;
    case "taken":
      return { kind: "google_link_taken" };
    default:
      return AUTH_FAILED;
  }
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 預かった戻りと依存を共有する手続きのファクトリで、内側の関数は個々に上限内である。外へ分けると状態を引数で渡すことになり、責務は分かれない。
export function createLinkGoogle({
  authenticator,
  emailIdentity,
  summaries,
  connectivity,
}: Dependencies): LinkGoogle {
  // 預かった追加の戻り(文書の中に1件だけ)。
  let capturedReturn: GoogleReturn | null = null;

  // 表示中のときだけ、操作の終わりを反映する。
  function finish(
    view: LinkGoogleView,
    result: {
      account: AccountSummary | null;
      failure: AuthFailure | null;
    },
  ) {
    if (!view.isMounted()) return;
    view.dispatch({
      type: "finished",
      account: result.account,
      failure: result.failure?.kind ?? null,
    });
  }

  // 読み直して記録を更新する。読めたときは概要を返し、サインインを失ったときと読めなかったときは理由を返す。
  async function reread(): Promise<AccountReading> {
    const reading = await authenticator.readAccount();
    if (reading.kind === "read") summaries.write(reading.account);
    return reading;
  }

  // 結果が分からない解除のとき、読み直した行を示す。まだ結び付いていれば失敗を示し、結び付きが無ければ何も示さない。読み直せなければ、記録の行のまま失敗を示す。
  async function finishUnknownUnlink(view: LinkGoogleView) {
    const reading = await reread();
    if (reading.kind === "lost") return;
    finish(view, {
      account: reading.kind === "read" ? reading.account : null,
      failure:
        reading.kind === "read" && reading.account.google === null
          ? null
          : UNLINK_FAILED,
    });
  }

  async function handleReturn(
    view: LinkGoogleView,
    googleReturn: GoogleReturn,
  ) {
    if (googleReturn.kind !== "code") {
      finish(view, { account: null, failure: returnFailureOf(googleReturn) });
      return;
    }
    if (!view.begin(beginGoogleLinkReturn)) return;
    // `code`は交換しない。結び付けは認証サービスが戻り(`/callback`)の時点で済ませている。読み直して行を更新する(知らせは出さない)。読み直せなかったときも何も示さず、行は記録のままにする(次に開いたときの読み直しで追いつく)。
    const reading = await reread();
    if (reading.kind === "lost") return;
    finish(view, {
      account: reading.kind === "read" ? reading.account : null,
      failure: null,
    });
  }

  async function refresh(view: LinkGoogleView) {
    if (connectivity.isOffline()) return;
    const reading = await reread();
    if (reading.kind === "read" && view.isMounted()) {
      view.dispatch({ type: "read", account: reading.account });
    }
  }

  return {
    stored: () => summaries.read(),
    async start(view) {
      // 押下の直前に1回だけ読む(購読しない)。判定は集約が行う。
      const offline = connectivity.isOffline();
      if (!view.begin((flow) => beginAddGoogle(flow, { offline }))) return;
      // 成功では、SDKがGoogleの画面へ移す。実行中は解除しない(bfcacheで戻ったときは画面が解く)。
      const failure = failureOf(
        await authenticator.startGoogleLink({ returnPath: RETURN_PATH }),
      );
      if (failure) finish(view, { account: null, failure: AUTH_FAILED });
    },
    capture(search) {
      capturedReturn = linkGoogleReturnOf(search);
      return capturedReturn !== null;
    },
    async resume(view) {
      const googleReturn = capturedReturn;
      capturedReturn = null;
      if (googleReturn === null) {
        await refresh(view);
        return;
      }
      await handleReturn(view, googleReturn);
    },
    async remove(input, view) {
      const offline = connectivity.isOffline();
      if (!view.begin((flow) => beginRemoveGoogle(flow, { offline }))) return;
      // 先にメールの手段を確かめる。失敗ならGoogleは変わらない。
      const prepared = failureOf(await emailIdentity.ensure());
      if (prepared) {
        finish(view, { account: null, failure: UNLINK_FAILED });
        return;
      }
      const unlinked = failureOf(
        await authenticator.unlinkGoogle(input.identityId),
      );
      if (unlinked) {
        // 拒否は理由だけを示す。結果が分からない(届かなかった)ときだけ、読み直した行で決める。
        if (unlinked.kind === "unreachable") await finishUnknownUnlink(view);
        else finish(view, { account: null, failure: UNLINK_FAILED });
        return;
      }
      const reading = await reread();
      if (reading.kind === "lost") return;
      // 解除は成功と確定している。読み直せたときは読み直した値、読み直せなかったときは記録の概要からGoogleを外した値で、行を「追加」にする。
      finish(view, {
        account:
          reading.kind === "read" ? reading.account : withoutGoogle(summaries),
        failure: null,
      });
    },
  };
}
