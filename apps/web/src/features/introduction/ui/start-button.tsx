import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { SIGN_IN_PATH } from "@/routes";

// 「記録を始める」。サインインの画面(経路表のSIGN_IN_PATH)へのリンクで、リンクなので、水和の前でも動く。
export function StartButton() {
  const t = useTranslations("introduction");
  return (
    <Link
      href={SIGN_IN_PATH}
      className={buttonVariants({ variant: "default" })}
    >
      {t("startButton")}
    </Link>
  );
}
