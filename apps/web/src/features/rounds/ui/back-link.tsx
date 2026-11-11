import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { originPathOf, type RoundOrigin } from "../domain/round-routes";

// 遷移元(ホームまたは履歴)へ戻るリンク。名前は表示と同じ「戻る」だけで、戻り先は含めない。
export function BackLink({
  origin,
  className,
}: {
  origin: RoundOrigin;
  className?: string;
}) {
  const t = useTranslations("rounds");
  return (
    <Link
      href={originPathOf(origin)}
      className={cn(
        "inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground",
        className,
      )}
    >
      <ChevronLeft className="size-4" />
      {t("back")}
    </Link>
  );
}
