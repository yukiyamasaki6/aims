"use client";

import { useTranslations } from "next-intl";
import { RoundsList } from "@/features/rounds/ui/rounds-list";

export default function RoundsPage() {
  const t = useTranslations("rounds");
  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col gap-6 p-8">
      <h1 className="font-heading text-2xl leading-snug font-medium">
        {t("listTitle")}
      </h1>

      <RoundsList />
    </main>
  );
}
