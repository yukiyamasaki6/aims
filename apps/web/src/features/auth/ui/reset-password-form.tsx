"use client";

import type { PasswordSetup } from "../application/password-setup";
import { PasswordSetupForm } from "./password-setup-form";

const SIGN_IN_LINK = { label: "サインインに戻る" };

const COPY = {
  idPrefix: "reset-password",
  emailTitle: "パスワードを再設定",
  emailFooter: SIGN_IN_LINK,
  passwordTitle: "新しいパスワードを設定",
  passwordDescription: "このパスワードで次回からサインインします。",
  passwordLabel: "新しいパスワード",
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
