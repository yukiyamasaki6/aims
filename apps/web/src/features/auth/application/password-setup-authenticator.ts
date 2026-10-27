import type { AuthFailure } from "../domain/auth-failure";

// 認証サービスが応答しなかった(接続を得られない、呼び出しが投げた)こと。送ったセキュリティチェックのトークンは使われていない。
type Unreached = { readonly kind: "unreached" };
export type Delivery =
  | { readonly kind: "sent" }
  | { readonly kind: "refused"; readonly failure: AuthFailure }
  | Unreached;

// 認証コードで本人確認をして、パスワードを設定する手続き(サインアップとパスワード再設定)が、認証サービスに頼むこと。
// どれも例外を投げず、失敗は値で返す。手続きごとに頼むことが増えるときは、この約束に足して拡張する。
export type PasswordSetupAuthenticator = {
  sendCode(request: { email: string; captchaToken: string }): Promise<Delivery>;
  verifyCode(request: {
    email: string;
    code: string;
  }): Promise<AuthFailure | null>;
  setPassword(password: string): Promise<AuthFailure | null>;
};
