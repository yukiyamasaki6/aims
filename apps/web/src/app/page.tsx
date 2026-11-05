"use client";

import { SIGN_UP_PATH } from "@/features/auth/domain/auth-routes";
import { IntroScreen } from "@/features/navigation/ui/intro-screen";

// 開始ボタンは常に/signupへのリンクで、認証済みなら/signupの認証済みの転送で一覧へ着く。
export default function Home() {
  return <IntroScreen startHref={SIGN_UP_PATH} />;
}
