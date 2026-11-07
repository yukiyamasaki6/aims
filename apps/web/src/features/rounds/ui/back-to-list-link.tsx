import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ROUNDS_PATH } from "@/routes";

export function BackToListLink({ className }: { className?: string }) {
  const t = useTranslations("rounds");
  return (
    <Link
      href={ROUNDS_PATH}
      className={cn(
        "inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground",
        className,
      )}
    >
      <ChevronLeft className="size-4" />
      {t("backToList")}
    </Link>
  );
}
