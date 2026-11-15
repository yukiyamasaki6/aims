import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";
import { ScreenFrame } from "@/components/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CHANGE_EMAIL_PATH, CHANGE_PASSWORD_PATH } from "@/routes";

// 設定の画面。見出しと、分類ごとの区画を描く。
// account: 分類「アカウント」の、メールアドレス変更とパスワード変更の項目に続く中身(サインアウトなど、認証の部品)。入口が渡す。
export function SettingsScreen({ account }: { account: ReactNode }) {
  const t = useTranslations("settings");
  const accountTitleId = useId();
  return (
    <ScreenFrame title={t("title")}>
      <div className="h-full overflow-y-auto">
        <main className="mx-auto flex min-h-full max-w-xl flex-col gap-8 p-8">
          <section
            aria-labelledby={accountTitleId}
            className="flex flex-col gap-2"
          >
            <h2
              id={accountTitleId}
              className="text-sm font-medium text-muted-foreground"
            >
              {t("accountTitle")}
            </h2>
            <div className="flex flex-col [&>*:first-child]:rounded-t-lg [&>*:first-child]:border-t [&>*:last-child]:rounded-b-lg">
              <Link
                href={CHANGE_EMAIL_PATH}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "row" }),
                )}
              >
                {t("changeEmailItem")}
              </Link>
              <Link
                href={CHANGE_PASSWORD_PATH}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "row" }),
                )}
              >
                {t("changePasswordItem")}
              </Link>
              {account}
            </div>
          </section>
        </main>
      </div>
    </ScreenFrame>
  );
}
