import type { ReactNode } from "react";

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex h-screen w-full max-w-sm flex-col items-center justify-center gap-4 overflow-y-auto p-8">
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
