// 認証の失敗の種類。サインイン(新規登録を含む)、メールアドレス変更、サインアウト、アカウント削除、他の機能が使う。
// 利用者向けの文言は持たない。文言は、UI層の文言の一覧が種類ごとに持つ。種類を作るのは、認証サービスとDB関数のエラーを写すインフラ層(拒否の種類、other)である。
// google_auth_failed: Googleでの認証(サインイン、追加)の開始・交換・戻りの失敗。google_unlink_failed: Googleの解除の失敗。google_link_taken: 追加するGoogleアカウントが別のアカウントで使われている。この3つは、手続きが作る。取り消しは、失敗の種類を作らない。
// google_only_address: 「メールで続ける」のアドレスが、Googleの手段にだけ残るアドレスだった(認証サービスの`user_already_exists`)。インフラ層が写す。
// 認証サービスに届かなかった(unreachable)ことを表す語は、この種類だけである。
// offline は、送信の前に端末のオフラインを判定した種類で、集約だけが作る(送信していないため、認証サービスの応答からは作らない)。unreachable は、送信したが認証サービスに届かなかった種類である。
export type AuthFailureKind =
  | "offline"
  | "unreachable"
  | "code_expired"
  | "rate_limited"
  | "captcha_failed"
  | "email_exists"
  | "same_email"
  | "google_auth_failed"
  | "google_unlink_failed"
  | "google_only_address"
  | "google_link_taken"
  | "other";

// 届かなかった、サインインしていない、認識している理由で拒否された、それ以外(認証サービスの文言は出さない)のどれか。
export type AuthFailure = { readonly kind: AuthFailureKind };

// 種類の値。失敗値を作る箇所は、ここだけである。
export const UNREACHABLE = { kind: "unreachable" } as const;
