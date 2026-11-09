import type { AuthFailure } from "../domain/auth-failure";

// 認証サービスへの頼みごとの結果。どの頼みごとも、この2つのどれかで返る(例外は投げない)。
// - accepted: 応答があり、受け付けられた。
// - failed: 成功ではなかった。拒否(応答があった)も、通信の断も、接続を得られない場合も含む。種類はfailureが持つ。
export type CallResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "failed"; readonly failure: AuthFailure };

// 失敗として扱うときの値。受け付けられたらnull、失敗ならその失敗。
export function failureOf(result: CallResult): AuthFailure | null {
  return result.kind === "accepted" ? null : result.failure;
}
