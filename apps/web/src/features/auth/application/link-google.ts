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
  type LinkGoogleNotice,
} from "../domain/link-google-flow";
import type { AccountSummaryStore } from "./account-summary-store";
import { type CallResult, failureOf } from "./call-result";
import type { ScreenView } from "./screen-view";

// アカウントの概要の読み直しの結果。lost: 認証サービスが現在の利用者を拒否した(サインインを失った)。
export type AccountReading =
  | { readonly kind: "read"; readonly account: AccountSummary }
  | { readonly kind: "failed"; readonly failure: AuthFailure }
  | { readonly kind: "lost" };

// 認証サービスにGoogleアカウントの追加・削除を頼む。例外は投げず、結果は値で返す。
// startGoogleLink: Googleの画面へ移す(移った後は結果を受け取らない)。returnPathは今のオリジンからの戻り先。
// readAccount: 現在の利用者を認証サービスから読み直す。unlinkGoogle: Googleの手段(identityId)を解除する。
export type LinkGoogleAuthenticator = {
  startGoogleLink(request: { returnPath: string }): Promise<CallResult>;
  readAccount(): Promise<AccountReading>;
  unlinkGoogle(identityId: string): Promise<CallResult>;
};

// Googleの削除の前に、メールの手段が無ければ作る。例外は投げず、結果は値で返す。
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
  // 削除の確認の後。メールの手段を確かめてから、Googleの手段を解除する。
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

// 戻りの失敗の理由。
function returnFailureKind(googleReturn: GoogleReturn) {
  switch (googleReturn.kind) {
    case "cancelled":
      return "google_link_cancelled";
    case "taken":
      return "google_link_taken";
    default:
      return "other";
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
      notice: LinkGoogleNotice | null;
      failure: AuthFailure | null;
    },
  ) {
    if (!view.isMounted()) return;
    view.dispatch({
      type: "finished",
      account: result.account,
      notice: result.notice,
      failure: result.failure?.kind ?? null,
    });
  }

  // 読み直して記録を更新する。読めたときは概要を返し、サインインを失ったときと読めなかったときは理由を返す。
  async function reread(): Promise<AccountReading> {
    const reading = await authenticator.readAccount();
    if (reading.kind === "read") summaries.write(reading.account);
    return reading;
  }

  // 結果が分からない失敗のとき、読み直した行を示す(読み直せなければ記録の行のまま)。
  async function finishWithFailure(view: LinkGoogleView, failure: AuthFailure) {
    const reading = await reread();
    if (reading.kind === "lost") return;
    finish(view, {
      account: reading.kind === "read" ? reading.account : null,
      notice: null,
      failure,
    });
  }

  async function handleReturn(
    view: LinkGoogleView,
    googleReturn: GoogleReturn,
  ) {
    if (googleReturn.kind !== "code") {
      finish(view, {
        account: null,
        notice: null,
        failure: { kind: returnFailureKind(googleReturn) },
      });
      return;
    }
    if (!view.begin(beginGoogleLinkReturn)) return;
    // `code`は交換しない。結び付けは認証サービスが戻り(`/callback`)の時点で済ませている。読み直して、結び付いていれば追加した旨を示す。
    const reading = await reread();
    if (reading.kind === "lost") return;
    if (reading.kind === "failed") {
      finish(view, { account: null, notice: null, failure: reading.failure });
      return;
    }
    finish(view, {
      account: reading.account,
      notice: reading.account.google === null ? null : "added",
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
      if (failure) finish(view, { account: null, notice: null, failure });
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
        finish(view, { account: null, notice: null, failure: prepared });
        return;
      }
      const unlinked = failureOf(
        await authenticator.unlinkGoogle(input.identityId),
      );
      if (unlinked) {
        // 拒否は理由だけを示す。結果が分からない(届かなかった)ときだけ、読み直した行を示す。
        if (unlinked.kind === "unreachable") {
          await finishWithFailure(view, unlinked);
        } else {
          finish(view, { account: null, notice: null, failure: unlinked });
        }
        return;
      }
      const reading = await reread();
      if (reading.kind === "lost") return;
      finish(view, {
        account: reading.kind === "read" ? reading.account : null,
        notice: "removed",
        failure: null,
      });
    },
  };
}
