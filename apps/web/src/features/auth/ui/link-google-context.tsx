"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { LinkGoogle } from "../application/link-google";

const LinkGoogleContext = createContext<LinkGoogle | null>(null);

// 設定の「Google認証」の行と、戻りを預ける入口へ、アプリで1つの手続き(入口が生成して渡す)を渡す。
export function LinkGoogleProvider({
  linkGoogle,
  children,
}: {
  linkGoogle: LinkGoogle;
  children: ReactNode;
}) {
  return (
    <LinkGoogleContext.Provider value={linkGoogle}>
      {children}
    </LinkGoogleContext.Provider>
  );
}

export function useLinkGoogle(): LinkGoogle {
  const linkGoogle = useContext(LinkGoogleContext);
  if (!linkGoogle) throw new Error("LinkGoogleProvider がありません。");
  return linkGoogle;
}
