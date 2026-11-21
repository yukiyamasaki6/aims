import { useTranslations } from "next-intl";
import type { MouseEvent, ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type SettingsItemView,
  settingsHashOf,
} from "../domain/settings-location";

// 項目の画面へ移る、行の右端のリンク。経路表のハッシュを`href`に持ち、押下は既定の動作を止めて、受け取った移る操作を呼ぶ。
function RowLink({
  view,
  onMove,
  children,
}: {
  view: SettingsItemView;
  onMove: (view: SettingsItemView) => void;
  children: ReactNode;
}) {
  return (
    <a
      href={settingsHashOf(view)}
      onClick={(event: MouseEvent) => {
        event.preventDefault();
        onMove(view);
      }}
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
    >
      {children}
    </a>
  );
}

// 行の名と、その右の領域(値と操作)。行全体はリンクにしない。
function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-3 text-sm">
      <span className="shrink-0">{name}</span>
      {children}
    </div>
  );
}

// 分類「アカウント」の本文。上から「メールアドレス」「Google認証」「アカウント削除」と、入口が渡すサインアウトの行を、行間だけを線で区切って並べる。本文に分類の見出しは置かない。
// email: 現在のメールアドレス(読めないときは空)。renderGoogle: 「Google認証」の値と操作(認証の部品)。onBusyChange: その処理中の知らせ。
// onMove: 項目の画面へ移る操作。signOut: サインアウトの行(認証の部品)。
export function SettingsAccount({
  email,
  renderGoogle,
  onBusyChange,
  onMove,
  signOut,
}: {
  email: string;
  renderGoogle: (controls: {
    onBusyChange: (busy: boolean) => void;
  }) => ReactNode;
  onBusyChange: (busy: boolean) => void;
  onMove: (view: SettingsItemView) => void;
  signOut: ReactNode;
}) {
  const t = useTranslations("settings");
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-xl p-8">
        <div className="flex flex-col [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-foreground/40">
          <Row name={t("emailRow")}>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {email}
            </span>
            <RowLink view="email" onMove={onMove}>
              {t("emailChange")}
            </RowLink>
          </Row>
          <Row name={t("googleRow")}>{renderGoogle({ onBusyChange })}</Row>
          <Row name={t("deleteAccountRow")}>
            <span className="flex-1" />
            <RowLink view="delete-account" onMove={onMove}>
              {t("deleteAccountAction")}
            </RowLink>
          </Row>
          {signOut}
        </div>
      </div>
    </div>
  );
}
