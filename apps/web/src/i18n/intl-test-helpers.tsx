import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { strictIntlConfig } from "./translator-test-helpers";

export function IntlTestProvider({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider {...strictIntlConfig}>
      {children}
    </NextIntlClientProvider>
  );
}
