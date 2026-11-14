import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CHANGE_PASSWORD_PATH } from "@/routes";

// 設定の画面。見出しと、分類ごとの区画を描く。
// account: 分類「アカウント」の、パスワード変更の項目に続く中身(サインアウトなど、認証の部品)。
// diagnostics: 分類「診断」の中身。入口が渡す。
export function SettingsScreen({
  account,
  diagnostics,
}: {
  account: ReactNode;
  diagnostics: ReactNode;
}) {
  const t = useTranslations("settings");
  const accountTitleId = useId();
  const diagnosticsTitleId = useId();
  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col gap-8 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <section aria-labelledby={accountTitleId} className="flex flex-col gap-2">
        <h2
          id={accountTitleId}
          className="text-sm font-medium text-muted-foreground"
        >
          {t("accountTitle")}
        </h2>
        <div className="flex flex-col [&>*:first-child]:rounded-t-lg [&>*:first-child]:border-t [&>*:last-child]:rounded-b-lg">
          <Link
            href={CHANGE_PASSWORD_PATH}
            className={cn(buttonVariants({ variant: "ghost", size: "row" }))}
          >
            {t("changePasswordItem")}
          </Link>
          {account}
        </div>
      </section>
      <section
        aria-labelledby={diagnosticsTitleId}
        className="flex flex-col gap-4"
      >
        <h2 id={diagnosticsTitleId} className="text-lg font-medium">
          {t("diagnosticsTitle")}
        </h2>
        {diagnostics}
      </section>
    </main>
  );
}
