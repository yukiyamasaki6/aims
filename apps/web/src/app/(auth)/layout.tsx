import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex h-dvh w-full max-w-sm flex-col items-center justify-center gap-4 overflow-y-auto p-8">
      {children}
    </main>
  );
}
