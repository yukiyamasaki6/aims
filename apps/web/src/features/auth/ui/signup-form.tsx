"use client";

import Link from "next/link";
import type { PasswordSetup } from "../application/password-setup";
import { PasswordSetupForm } from "./password-setup-form";

const COPY = {
  idPrefix: "signup",
  emailTitle: "サインアップ",
  emailFooter: (
    <p className="text-muted-foreground text-sm">
      既にアカウントをお持ちの方は{" "}
      <Link href="/signin" className="underline">
        サインイン
      </Link>
    </p>
  ),
  passwordTitle: "パスワードを設定",
  passwordDescription: "次回以降はこのパスワードでサインインします。",
  passwordPlaceholder: "パスワード（8文字以上・英数字を含む）",
  passwordSubmit: "登録してサインイン",
  passwordFooter: null,
};

export function SignUpForm({ signUp }: { signUp: PasswordSetup }) {
  return <PasswordSetupForm procedure={signUp} copy={COPY} />;
}
