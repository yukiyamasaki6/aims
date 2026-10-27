"use client";

import Link from "next/link";
import type { PasswordSetup } from "../application/password-setup";
import { PasswordSetupForm } from "./password-setup-form";

const SIGN_IN_LINK = (
  <p className="text-muted-foreground text-sm">
    <Link href="/signin" className="underline">
      サインインに戻る
    </Link>
  </p>
);

const COPY = {
  idPrefix: "reset-password",
  emailTitle: "パスワードを再設定",
  emailFooter: SIGN_IN_LINK,
  passwordTitle: "新しいパスワードを設定",
  passwordDescription: "このパスワードで次回からサインインします。",
  passwordPlaceholder: "新しいパスワード（8文字以上・英数字を含む）",
  passwordSubmit: "パスワードを変更",
  passwordFooter: SIGN_IN_LINK,
};

export function ResetPasswordForm({
  resetPassword,
}: {
  resetPassword: PasswordSetup;
}) {
  return <PasswordSetupForm procedure={resetPassword} copy={COPY} />;
}
