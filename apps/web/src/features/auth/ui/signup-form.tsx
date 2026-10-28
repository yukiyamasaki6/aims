"use client";

import type { PasswordSetup } from "../application/password-setup";
import { PasswordSetupForm } from "./password-setup-form";

const COPY = {
  idPrefix: "signup",
  emailTitle: "サインアップ",
  emailFooter: { lead: "既にアカウントをお持ちの方は", label: "サインイン" },
  passwordTitle: "パスワードを設定",
  passwordDescription: "次回以降はこのパスワードでサインインします。",
  passwordLabel: "パスワード",
  passwordSubmit: "登録してサインイン",
  passwordFooter: null,
};

export function SignUpForm({ signUp }: { signUp: PasswordSetup }) {
  return <PasswordSetupForm procedure={signUp} copy={COPY} />;
}
