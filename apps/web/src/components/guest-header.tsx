import Link from "next/link";
import { useTranslations } from "next-intl";
import { LogoImage } from "@/components/logo-image";
import { buttonVariants } from "@/components/ui/button";
import { HOME_PATH, SIGN_IN_PATH, SIGN_UP_PATH } from "@/routes";

// ログイン前の画面(紹介・認証)が共有するヘッダー。左端にロゴ、右端にサインインとサインアップのリンクを置く。見出しとメニューは持たない。
export function GuestHeader() {
  const t = useTranslations("shared");
  return (
    <header className="flex h-16 shrink-0 items-center border-b px-4">
      <Link href={HOME_PATH} className="shrink-0">
        <LogoImage />
      </Link>
      <div className="ml-auto flex gap-2">
        <Link
          href={SIGN_IN_PATH}
          className={buttonVariants({ variant: "ghost" })}
        >
          {t("headerSignIn")}
        </Link>
        <Link
          href={SIGN_UP_PATH}
          className={buttonVariants({ variant: "outline" })}
        >
          {t("headerSignUp")}
        </Link>
      </div>
    </header>
  );
}
