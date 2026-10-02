import type { ReactNode } from "react";
import { AppLogo } from "@/components/app-logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppLogo />
      <main className="mx-auto mt-14 flex h-[calc(100dvh-3.5rem)] w-full max-w-sm flex-col items-center justify-center gap-4 overflow-y-auto p-8">
        {children}
      </main>
    </>
  );
}
