import type { CallResult } from "./call-result";
import type { PasswordSetupAuthenticator } from "./password-setup-authenticator";
import type { PasswordChange } from "./reset-password";

// 全ての端末のサインインを終えさせる。パスワードの変更の後に頼む。例外は投げない。
export type SignOutEverywhere = {
  signOutEverywhere(): Promise<CallResult>;
};

// サーバーで行う、パスワードの変更と全ての端末のサインインの終了の手続き。再設定の画面の手続きの約束(PasswordChange)を満たす。
// 要求の入口が、要求の利用者のセッションの接続で作った認証の実装を渡して生成し、1回の要求で呼ぶ。
// 変更に成功したときだけ終了を頼み、終了の結果によらず、変更の結果を返す(終了が届かない・拒否されても、変更済みのパスワードで先へ進めるため)。例外は投げない。
export function createPasswordChange({
  authenticator,
}: {
  authenticator: Pick<PasswordSetupAuthenticator, "setPassword"> &
    SignOutEverywhere;
}): PasswordChange {
  return {
    async change(password) {
      const result = await authenticator.setPassword(password);
      if (result.kind === "accepted") await authenticator.signOutEverywhere();
      return result;
    },
  };
}
