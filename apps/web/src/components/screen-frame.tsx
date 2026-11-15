"use client";

import { createContext, type ReactNode, useContext } from "react";

// ヘッダー行の先頭に置くメニュー部品。文脈が無い(null)画面ではメニューを出さない。
const ScreenMenuContext = createContext<ReactNode>(null);

export function ScreenMenuProvider({
  menu,
  children,
}: {
  menu: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScreenMenuContext.Provider value={menu}>
      {children}
    </ScreenMenuContext.Provider>
  );
}

// ログイン後の全画面で共用するヘッダー枠。枠の高さ(下線を含めて45px)は全画面で同じにし、遷移でヘッダーを動かさない。
// 本文領域の枠は高さを子に与えるだけで、スクロールしない。スクロールの有無と入れ物は各画面が決める。
export function ScreenFrame({
  title,
  leading,
  trailing,
  children,
}: {
  title?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const menu = useContext(ScreenMenuContext);
  return (
    <div className="flex h-full flex-col">
      <header className="h-[45px] shrink-0 border-b bg-card">
        <div className="flex h-full w-full items-center gap-2 px-1.5">
          {menu}
          {leading}
          {title && (
            <h1 className="truncate p-1.5 text-base leading-5">{title}</h1>
          )}
          {trailing && (
            <div className="ml-auto flex items-center gap-2">{trailing}</div>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
