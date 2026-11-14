import { useTranslations } from "next-intl";
import { AppLogo } from "@/components/app-logo";

export function OfflineScreen() {
  const t = useTranslations("offlinePwa");
  return (
    <>
      <AppLogo />
      <main className="mx-auto mt-14 flex h-[calc(100%-3.5rem)] w-full max-w-sm flex-col items-center justify-center gap-4 overflow-y-auto p-8">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-heading text-2xl leading-snug font-medium">
            {t("offlineTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("offlineDescription")}
          </p>
        </div>
      </main>
    </>
  );
}
