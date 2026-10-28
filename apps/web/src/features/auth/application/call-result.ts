import type { AuthFailure, UNREACHABLE } from "../domain/auth-failure";

// 認証サービスへの頼みごとの結果。ブラウザ側のどの頼みごとも、この3つのどれかで返る(例外は投げない)。
// - accepted: 応答があり、受け付けられた。
// - refused: 応答があり、成功ではなかった。通信の断を値で返す場合(failureがunreachable)を含む。応答があったので、送ったセキュリティチェックのトークンは使われている。
// - unreachable: 応答が無かった(呼び出しが投げた、接続を得られない)。トークンは使われていない。
// 「届かなかった」を表す語は、unreachableだけである(AuthFailureの種類、この結果、同じ値)。
export type CallResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "refused"; readonly failure: AuthFailure }
  | typeof UNREACHABLE;

// 失敗として扱うときの値。受け付けられたらnull、拒否されたらその失敗、届かなかったら通信エラー。
export function failureOf(result: CallResult): AuthFailure | null {
  if (result.kind === "accepted") return null;
  return result.kind === "refused" ? result.failure : result;
}
