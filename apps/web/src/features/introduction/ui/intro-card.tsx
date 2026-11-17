import type { ReactNode } from "react";
import { FIGURE_BACKGROUND } from "./figure-svg";

type IntroCardProps = {
  number: string;
  figure: ReactNode;
  title: string;
  body: readonly string[];
};

// 紹介のカード1枚。上に図、下に番号・見出し・本文(段落ごと)を置く。
export function IntroCard({ number, figure, title, body }: IntroCardProps) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border bg-background">
      <div
        className="flex items-center justify-center p-4 text-foreground"
        style={{ backgroundColor: FIGURE_BACKGROUND }}
      >
        {figure}
      </div>
      <div className="flex flex-col gap-2 p-4">
        <p className="font-heading text-sm text-muted-foreground">{number}</p>
        <h2 className="font-heading text-base leading-snug font-medium">
          {title}
        </h2>
        {body.map((paragraph) => (
          <p key={paragraph} className="text-sm text-muted-foreground">
            {paragraph}
          </p>
        ))}
      </div>
    </article>
  );
}
