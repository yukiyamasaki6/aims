import type { CallResult } from "./call-result";

// 認証コードの目的。コードを送る呼び出しと確認する呼び出しの、認証サービスでの種別を決める。
export type CodePurpose = "sign-up" | "password-reset";

// 認証コードで本人確認をして、パスワードを設定する手続き(サインアップとパスワード再設定)が、認証サービスに頼むこと。
// 例外は投げず、結果は値で返す。
export type PasswordSetupAuthenticator = {
  sendCode(request: {
    purpose: CodePurpose;
    email: string;
    captchaToken: string;
  }): Promise<CallResult>;
  verifyCode(request: {
    purpose: CodePurpose;
    email: string;
    code: string;
  }): Promise<CallResult>;
  // パスワードを設定する。サインアップはブラウザの接続で、再設定はサーバーの接続で頼む。
  setPassword(password: string): Promise<CallResult>;
};
