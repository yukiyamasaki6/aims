import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ROUNDS_PATH } from "../domain/round-routes";

export function BackToListLink() {
  const t = useTranslations("rounds");
  return (
    <Link
      href={ROUNDS_PATH}
      className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      {t("backToList")}
    </Link>
  );
}
