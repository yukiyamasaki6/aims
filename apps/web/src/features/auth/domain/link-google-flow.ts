import type { AccountSummary } from "./account-summary";
import type { AuthFailureKind } from "./auth-failure";
import type { Start } from "./flow";

// 設定の「Google認証」の行の流れ。操作中(追加、削除)と確認中の排他、開始の判定(実行中 → オフライン)、結果の知らせと失敗の種類を守る集約。
// チェックのトークンを持たない(OAuthと解除は認証サービスのチェックの対象外)。

export type LinkGoogleNotice = "added" | "removed";

export type LinkGoogleFlow = {
  // 行に示すアカウントの概要。読み込み中(記録が無く、まだ読めていない)はnull。
  readonly account: AccountSummary | null;
  // adding: Googleの画面への移動中、または戻りの処理中。removing: 削除中。
  readonly pending: "adding" | "removing" | null;
  // 削除の確認ダイアログを開いている。
  readonly confirming: boolean;
  readonly notice: LinkGoogleNotice | null;
  readonly error: AuthFailureKind | null;
};

export function initialLinkGoogleFlow(
  account: AccountSummary | null,
): LinkGoogleFlow {
  return {
    account,
    pending: null,
    confirming: false,
    notice: null,
    error: null,
  };
}

// 追加の開始の命令。判定の順序は、実行中・読み込み中 → オフライン。
// 実行中、読み込み中なら開始しない。オフラインなら、通信せず、オフラインを示す。開始では以前の知らせとエラーを消す。
export function beginAddGoogle(
  flow: LinkGoogleFlow,
  input: { offline: boolean },
): Start<LinkGoogleFlow, true> {
  if (flow.pending !== null || flow.account === null) {
    return { state: flow, request: null };
  }
  if (input.offline) {
    return {
      state: { ...flow, notice: null, error: "offline" },
      request: null,
    };
  }
  return {
    state: { ...flow, pending: "adding", notice: null, error: null },
    request: true,
  };
}

// 戻りの処理の開始。実行中なら開始しない。
export function beginGoogleLinkReturn(
  flow: LinkGoogleFlow,
): Start<LinkGoogleFlow, true> {
  if (flow.pending !== null) return { state: flow, request: null };
  return {
    state: { ...flow, pending: "adding", notice: null, error: null },
    request: true,
  };
}

// 削除の開始の命令(確認の後)。判定の順序は、実行中 → オフライン。オフラインでは、確認を閉じてオフラインを示す。
export function beginRemoveGoogle(
  flow: LinkGoogleFlow,
  input: { offline: boolean },
): Start<LinkGoogleFlow, true> {
  if (flow.pending !== null) return { state: flow, request: null };
  if (input.offline) {
    return {
      state: { ...flow, confirming: false, notice: null, error: "offline" },
      request: null,
    };
  }
  return {
    state: { ...flow, pending: "removing", notice: null, error: null },
    request: true,
  };
}

// 画面で起きた事実。開始の命令は含まない(begin*)。
// confirmRequested: 「削除」の押下。結び付きがあり、実行中でないときだけ確認を開く。confirmCancelled: 確認を閉じた(削除中は閉じない)。
// read: 認証サービスから読み直した概要。finished: 操作の終わり。概要(読み直せたとき)、知らせ、失敗の種類を反映し、実行中と確認を解く。
// restored: bfcacheで戻り、移る前の追加の実行中が復元された。実行中を解く。
export type LinkGoogleEvent =
  | { type: "confirmRequested" }
  | { type: "confirmCancelled" }
  | { type: "read"; account: AccountSummary }
  | {
      type: "finished";
      account: AccountSummary | null;
      notice: LinkGoogleNotice | null;
      failure: AuthFailureKind | null;
    }
  | { type: "restored" };

export function linkGoogleReducer(
  flow: LinkGoogleFlow,
  event: LinkGoogleEvent,
): LinkGoogleFlow {
  switch (event.type) {
    case "confirmRequested":
      return flow.pending === null && flow.account?.google
        ? { ...flow, confirming: true, notice: null, error: null }
        : flow;
    case "confirmCancelled":
      return flow.pending === "removing"
        ? flow
        : { ...flow, confirming: false };
    case "read":
      return { ...flow, account: event.account };
    case "finished":
      return {
        ...flow,
        account: event.account ?? flow.account,
        pending: null,
        confirming: false,
        notice: event.notice,
        error: event.failure,
      };
    case "restored":
      return flow.pending === "adding" ? { ...flow, pending: null } : flow;
  }
}
