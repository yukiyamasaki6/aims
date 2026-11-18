import { useTranslations } from "next-intl";
import { CloudFigure } from "./cloud-figure";
import { HistoryFigure } from "./history-figure";
import { IntroCard } from "./intro-card";
import { IntroHeader } from "./intro-header";
import { OfflineFigure } from "./offline-figure";
import { PresetFigure } from "./preset-figure";
import { SetupFigure } from "./setup-figure";
import { StartButton } from "./start-button";

const ITEMS = [
  { id: "setup", bodies: ["setupBody1", "setupBody2"], Figure: SetupFigure },
  {
    id: "preset",
    bodies: ["presetBody1", "presetBody2"],
    Figure: PresetFigure,
  },
  { id: "cloud", bodies: ["cloudBody1", "cloudBody2"], Figure: CloudFigure },
  {
    id: "offline",
    bodies: ["offlineBody1", "offlineBody2"],
    Figure: OfflineFigure,
  },
  {
    id: "history",
    bodies: ["historyBody1", "historyBody2"],
    Figure: HistoryFigure,
  },
] as const;

// 紹介画面。専用のヘッダーの下で、本文だけがスクロールする。認証状態によらず同じ内容である。
export function IntroScreen() {
  const t = useTranslations("introduction");
  return (
    <div className="flex h-full flex-col">
      <IntroHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <main className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 p-8">
          <div className="flex w-full max-w-3xl flex-col items-center gap-6 text-center">
            <h1 className="font-heading text-3xl leading-tight font-bold tracking-tight text-balance [word-break:auto-phrase] sm:text-4xl">
              {t("catch")}
            </h1>
            <StartButton />
          </div>
          <div className="grid w-full gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
            {ITEMS.map(({ id, bodies, Figure }, index) => (
              <IntroCard
                key={id}
                number={String(index + 1).padStart(2, "0")}
                figure={<Figure />}
                title={t(`${id}Title`)}
                body={bodies.map((key) => t(key))}
              />
            ))}
          </div>
          <StartButton />
        </main>
      </div>
    </div>
  );
}
