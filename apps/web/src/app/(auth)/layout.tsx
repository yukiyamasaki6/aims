import Link from "next/link";
import type { ReactNode } from "react";
import { LogoImage } from "@/components/logo-image";
import { HOME_PATH } from "@/routes";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center justify-center gap-4 p-8">
        <Link href={HOME_PATH}>
          <LogoImage />
        </Link>
        {children}
      </main>
    </div>
  );
}
