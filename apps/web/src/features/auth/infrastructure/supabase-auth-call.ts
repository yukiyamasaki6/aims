import type { AuthError } from "@supabase/supabase-js";
import type { Delivery } from "../application/password-setup-authenticator";
import type { AuthFailure } from "../domain/auth-failure";
import { toAuthFailure } from "./supabase-auth-failure";

type AuthResponse = { error: AuthError | null };

// 認証サービスの呼び出しを、例外を投げずに値で返す(約束の実装が共有する、外部の失敗を内側の形にする変換)。
// 応答があって拒否されたときは、その失敗の種類を返す。呼び出しが投げたとき(接続を得られない場合を含む)は、通信エラーにする。
export async function toFailure(
  call: () => Promise<AuthResponse>,
): Promise<AuthFailure | null> {
  try {
    const { error } = await call();
    return error ? toAuthFailure(error) : null;
  } catch {
    return { kind: "unreachable" };
  }
}

// コードの送信の依頼。応答が無かった(呼び出しが投げた)ことと、応答があって拒否されたことを区別する。
// 認証サービスのエラーは値で返ることがあり、そのときは応答があったとして拒否にする(通信の断を値で返す場合を含む)。
export async function toDelivery(
  call: () => Promise<AuthResponse>,
): Promise<Delivery> {
  try {
    const { error } = await call();
    return error
      ? { kind: "refused", failure: toAuthFailure(error) }
      : { kind: "sent" };
  } catch {
    return { kind: "unreached" };
  }
}
