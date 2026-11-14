import { useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";

// 設定の画面。見出しと、分類ごとの区画を描く。分類の内容は入口が渡す。
// account: 分類「アカウント」の中身。diagnostics: 分類「診断」の中身。
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
      <section aria-labelledby={accountTitleId} className="flex flex-col gap-4">
        <h2 id={accountTitleId} className="text-lg font-medium">
          {t("accountTitle")}
        </h2>
        {account}
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
