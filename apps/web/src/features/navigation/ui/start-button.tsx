import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { SIGN_UP_PATH } from "@/routes";

// 開始ボタン。サインアップの画面(経路表のSIGN_UP_PATH)へのリンクで、リンクなので、水和の前でも動く。
export function StartButton() {
  const t = useTranslations("navigation");
  return (
    <Link
      href={SIGN_UP_PATH}
      className={buttonVariants({ variant: "default" })}
    >
      {t("startButton")}
    </Link>
  );
}
