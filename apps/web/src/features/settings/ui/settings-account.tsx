import { useTranslations } from "next-intl";
import type { MouseEvent, ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type SettingsItemView,
  settingsHashOf,
} from "../domain/settings-location";

const ITEMS = [
  { view: "email", textKey: "changeEmailItem" },
  { view: "delete-account", textKey: "deleteAccountItem" },
] as const satisfies readonly {
  view: SettingsItemView;
  textKey: string;
}[];

// 分類「アカウント」の本文。項目のリンクと、入口が渡すサインアウトの行を、項目間だけを線で区切って並べる。本文に分類の見出しは置かない。
// onMove: 項目の画面へ移る操作。signOut: サインアウトの行(認証の部品)。
export function SettingsAccount({
  onMove,
  signOut,
}: {
  onMove: (view: SettingsItemView) => void;
  signOut: ReactNode;
}) {
  const t = useTranslations("settings");
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-xl p-8">
        <div className="flex flex-col [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-foreground/40">
          {ITEMS.map(({ view, textKey }) => (
            <a
              key={view}
              href={settingsHashOf(view)}
              onClick={(event: MouseEvent) => {
                event.preventDefault();
                onMove(view);
              }}
              className={cn(buttonVariants({ variant: "ghost", size: "row" }))}
            >
              {t(textKey)}
            </a>
          ))}
          {signOut}
        </div>
      </div>
    </div>
  );
}
