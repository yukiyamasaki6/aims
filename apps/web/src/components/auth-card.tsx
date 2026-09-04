import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

export function AuthCard({
  title,
  description,
  onBack,
  children,
}: {
  title: string;
  description?: string;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-sm flex-col items-center justify-center gap-4 overflow-y-auto p-8">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex w-fit items-center gap-1 self-start text-muted-foreground text-sm hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          戻る
        </button>
      )}
      <div className="flex flex-col gap-1 text-center">
        <h1 className="font-heading text-2xl leading-snug font-medium">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </main>
  );
}
