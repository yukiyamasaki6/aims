import type { ReactNode } from "react";
import { GuestHeader } from "@/components/guest-header";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <GuestHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <main className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center justify-center gap-4 p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
