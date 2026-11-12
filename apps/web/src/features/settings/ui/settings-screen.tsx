import { useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";

// 設定の画面。見出しと、分類ごとの区画を描く。分類の内容は入口が渡す。
// account: 分類「アカウント」の中身。
export function SettingsScreen({ account }: { account: ReactNode }) {
  const t = useTranslations("settings");
  const accountTitleId = useId();
  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col gap-8 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <section aria-labelledby={accountTitleId} className="flex flex-col gap-4">
        <h2 id={accountTitleId} className="text-lg font-medium">
          {t("accountTitle")}
        </h2>
        {account}
      </section>
    </main>
  );
}
