import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { SETTINGS_ACCOUNT_HASH } from "@/routes";

const CLASS_NAME =
  "inline-flex w-fit items-center gap-1 p-1.5 text-muted-foreground text-sm";

// 設定パネルの分類「アカウント」へ戻るリンク。押下は既定の動作を止めて、onBack(設定パネルの移る操作)を呼ぶ。
// disabledの間は、リンクではない要素にして、押下もフォーカスも受けない。
export function SettingsBackLink({
  disabled,
  onBack,
}: {
  disabled: boolean;
  onBack: () => void;
}) {
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
    <a
      href={SETTINGS_ACCOUNT_HASH}
      onClick={(event) => {
        event.preventDefault();
        onBack();
      }}
      className={cn(CLASS_NAME, "hover:text-foreground")}
    >
      {content}
    </a>
  );
}
