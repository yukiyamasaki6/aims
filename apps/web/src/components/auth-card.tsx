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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-xl font-bold">{title}</h1>
      {description && (
        <p className="text-muted-foreground text-center text-sm">
          {description}
        </p>
      )}
      {children}
    </main>
  );
}
