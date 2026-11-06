import { useTranslations } from "next-intl";
import { AppLogo } from "@/components/app-logo";
import { StartButton } from "./start-button";

// 紹介画面。アプリ名、説明文、左上のロゴ、開始ボタンを表示する。認証状態によらず同じ内容である。
export function IntroScreen({ startHref }: { startHref: string }) {
  const t = useTranslations("navigation");
  return (
    <>
      <AppLogo />
      <main className="mx-auto mt-14 flex h-[calc(100dvh-3.5rem)] w-full max-w-sm flex-col items-center justify-center gap-4 overflow-y-auto p-8">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-heading text-2xl leading-snug font-medium">
            {t("introTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("introDescription")}
          </p>
        </div>
        <StartButton href={startHref} />
      </main>
    </>
  );
}
