import { AppLogo } from "@/components/app-logo";
import { StartButton } from "./start-button";

export default function Home() {
  return (
    <>
      <AppLogo />
      <main className="mx-auto mt-14 flex h-[calc(100dvh-3.5rem)] w-full max-w-sm flex-col items-center justify-center gap-4 overflow-y-auto p-8">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-heading text-2xl leading-snug font-medium">
            AIMS
          </h1>
          <p className="text-sm text-muted-foreground">
            アーチェリーのスコア記録・分析・共有アプリ
          </p>
        </div>
        <StartButton />
      </main>
    </>
  );
}
