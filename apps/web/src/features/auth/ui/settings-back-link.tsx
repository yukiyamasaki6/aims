import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SETTINGS_PATH } from "@/routes";

const CLASS_NAME =
  "inline-flex w-fit items-center gap-1 p-1.5 text-muted-foreground text-sm";

// 設定へ戻るリンク。disabledの間は、リンクではない要素にして、押下もフォーカスも受けない。
export function SettingsBackLink({ disabled }: { disabled: boolean }) {
  const t = useTranslations("auth");
  const content = (
    <>
      <ChevronLeft className="size-4" />
      {t("back")}
    </>
  );
  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(CLASS_NAME, "opacity-50")}>
        {content}
      </span>
    );
  }
  return (
    <Link
      href={SETTINGS_PATH}
      className={cn(CLASS_NAME, "hover:text-foreground")}
    >
      {content}
    </Link>
  );
}
