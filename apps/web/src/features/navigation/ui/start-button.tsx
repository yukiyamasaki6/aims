import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";

// 開始ボタン。行き先は入口が渡す。リンクなので、水和の前でも動く。
export function StartButton({ href }: { href: string }) {
  const t = useTranslations("navigation");
  return (
    <Link href={href} className={buttonVariants({ variant: "default" })}>
      {t("startButton")}
    </Link>
  );
}
